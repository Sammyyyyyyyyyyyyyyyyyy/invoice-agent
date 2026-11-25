"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Extracted, PurchaseOrder, Run, StageResult, Vendor } from "@/lib/types";

const STAGES: [StageResult["key"], string][] = [
  ["read", "Read invoice"], ["vendor", "Check vendor"], ["duplicate", "Check duplicates"], ["tax", "Check the maths"],
  ["po", "Find purchase order"], ["match", "Match amount to PO"], ["pattern", "Check vendor history"], ["decision", "Decision"],
];

const SAMPLES = [
  { f: "01_happy_dell_laptops.pdf", n: "Dell — laptops", h: "Happy path · ₹300 over PO" },
  { f: "02_split_A_urbanladder.pdf", n: "Urban Ladder — invoice 1 of 3", h: "Split PO · part bill" },
  { f: "03_split_B_urbanladder.pdf", n: "Urban Ladder — invoice 2 of 3", h: "Split PO · uses up the rest" },
  { f: "04_split_C_urbanladder.pdf", n: "Urban Ladder — invoice 3 of 3", h: "Split PO · nothing left" },
  { f: "05_scanned_no_po_quickoffice.pdf", n: "Quick Office — scanned", h: "Scan · no PO number" },
  { f: "06_bank_changed_aws.pdf", n: "AWS — cloud bill", h: "Bank account changed" },
  { f: "07_vendor_creep_swift.pdf", n: "Swift Logistics — freight", h: "Small overcharge, 4th time" },
  { f: "08_duplicate_dell_laptops.pdf", n: "Dell — laptops (again)", h: "Built-in: duplicate" },
  { f: "09_tax_wrong_dell_monitors.pdf", n: "Dell — monitors", h: "Built-in: tax maths wrong" },
  { f: "10_invalid_vendor_zenith.pdf", n: "Zenith Traders", h: "Unknown vendor" },
];

const inr = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : "₹" + (Math.round(n * 100) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const icon = (s: string) => ({ pass: "✓", warn: "!", fail: "✕", skip: "–", running: "…" } as Record<string, string>)[s] ?? "";
const statusWord = (s: string) => ({ pass: "passed", warn: "needs attention", fail: "failed", skip: "skipped", running: "running" } as Record<string, string>)[s] ?? "";
const REJECT_TAGS = ["Invalid vendor", "Duplicate invoice"];

function Tags({ tags, high }: { tags: string[]; high?: boolean }) {
  return <>{tags.map((t) => <span key={t} className={"tag " + (t === "Bank changed" && high ? "hi" : REJECT_TAGS.includes(t) ? "bad" : "")}>{t}</span>)}</>;
}

export default function Home() {
  const [tab, setTab] = useState<"process" | "dashboard" | "data">("process");
  const [runs, setRuns] = useState<Run[]>([]);
  const [resetting, setResetting] = useState(false);

  const refresh = useCallback(async () => {
    const r = await fetch("/api/runs").then((x) => x.json()).catch(() => ({ runs: [] }));
    setRuns(r.runs ?? []);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  async function reset() {
    if (!window.confirm("Reset demo data? This clears all runs and restores the vendor list, POs and history.")) return;
    setResetting(true);
    await fetch("/api/reset", { method: "POST" });
    await refresh();
    setResetting(false);
  }

  return (
    <>
      <div className="topbar">
        <div className="logo">🧾 Invoice Agent <small>· Acme Retail · Accounts Payable</small></div>
        <div className="tabs">
          <button className={"tab" + (tab === "process" ? " active" : "")} onClick={() => setTab("process")}>Process invoice</button>
          <button className={"tab" + (tab === "dashboard" ? " active" : "")} onClick={() => { setTab("dashboard"); refresh(); }}>Dashboard ({runs.filter((r) => !r.seeded).length})</button>
          <button className={"tab" + (tab === "data" ? " active" : "")} onClick={() => setTab("data")}>Vendors, POs &amp; rules</button>
        </div>
        <div className="spacer" />
        <button className="btn" onClick={reset} disabled={resetting}>{resetting ? "Resetting…" : "↺ Reset demo data"}</button>
      </div>
      <main>
        {tab === "process" && <Process onDone={refresh} />}
        {tab === "dashboard" && <Dashboard runs={runs} />}
        {tab === "data" && <RefData />}
      </main>
    </>
  );
}

// ---------------- LIVE RUN VIEW ----------------
type Live = { note: string | null; model: string | null; ms: number | null; status: Record<string, string>; results: Record<string, StageResult>; extracted: Extracted | null; run: Run | null; error: string | null; file: string };

function Process({ onDone }: { onDone: () => void }) {
  const [live, setLive] = useState<Live | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);

  async function process(file: File) {
    setBusy(true);
    setLive({ note: null, model: null, ms: null, status: {}, results: {}, extracted: null, run: null, error: null, file: file.name });
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/process", { method: "POST", body: fd });
      if (!res.body) throw new Error("No response");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          setLive((l) => {
            if (!l) return l;
            const n = { ...l, status: { ...l.status }, results: { ...l.results } };
            if (ev.type === "running") n.status[ev.key] = "running";
            if (ev.type === "extracted") { n.extracted = ev.extracted; n.model = ev.model; n.ms = ev.ms; n.note = null; }
            if (ev.type === "note") n.note = ev.message;
            if (ev.type === "stage") { n.status[ev.stage.key] = ev.stage.status; n.results[ev.stage.key] = ev.stage; }
            if (ev.type === "done") n.run = ev.run;
            if (ev.type === "error") n.error = ev.message;
            return n;
          });
        }
      }
    } catch (e: any) {
      setLive((l) => (l ? { ...l, error: e.message } : l));
    }
    setBusy(false);
    onDone();
  }

  async function runSample(f: string) {
    const blob = await fetch("/samples/" + f).then((r) => r.blob());
    process(new File([blob], f, { type: "application/pdf" }));
  }

  const ex = live?.extracted;
  return (
    <div className="grid2">
      <div className="panel">
        <h2>1 · Drop in an invoice</h2>
        <p className="sub">PDF or photo/scan. The AI reads it; the rules decide.</p>
        <label className={"drop" + (over ? " over" : "")}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f && !busy) process(f); }}>
          <strong>Drag an invoice here</strong>or click to choose a file
          <input type="file" accept="application/pdf,image/*" hidden disabled={busy}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) process(f); e.target.value = ""; }} />
        </label>
        <div className="samples">
          <div className="sub" style={{ margin: "4px 0 2px" }}>Or run a test invoice:</div>
          {SAMPLES.map((s) => (
            <button key={s.f} className="sample" disabled={busy} onClick={() => runSample(s.f)}>
              <span><span className="n">{s.n}</span><br /><span className="h">{s.h}</span></span>
              <a href={"/samples/" + s.f} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>view</a>
            </button>
          ))}
        </div>
      </div>

      <div className="panel">
        <h2>2 · Live run {live && <span className="muted" style={{ fontWeight: 400 }}>— {live.file}</span>}</h2>
        {!live ? (
          <div className="empty">Pick an invoice on the left to watch each check run.</div>
        ) : (
          <>
            <ol className="steps">
              {STAGES.map(([key, label]) => {
                const st = live.status[key];
                const r = live.results[key];
                return (
                  <li key={key} className={"step" + (st ? "" : " pending")}>
                    <div className={"dot " + (st ?? "")}>{icon(st ?? "") || "·"}</div>
                    <div>
                      <div className="title">{label}{st && <span className="t-status">{statusWord(st)}</span>}</div>
                      {key === "read" && live.note && !ex && <div className="detail muted">{live.note}</div>}
                      {key === "read" && live.model && <div className="detail muted" style={{ fontSize: 12 }}>Read by {live.model} in {((live.ms ?? 0) / 1000).toFixed(1)}s</div>}
                      {key === "read" && ex && (
                        <div className="kv">
                          <div><span>Vendor</span><b>{ex.vendor_name ?? "—"}</b></div>
                          <div><span>Invoice #</span><b>{ex.invoice_number ?? "—"}</b></div>
                          <div><span>Date</span><b>{ex.invoice_date ?? "—"}</b></div>
                          <div><span>PO #</span><b>{ex.po_number ?? "not on invoice"}</b></div>
                          <div><span>Subtotal</span><b>{inr(ex.subtotal)}</b></div>
                          <div><span>Tax</span><b>{inr(ex.tax)}</b></div>
                          <div><span>Total</span><b>{inr(ex.total)}</b></div>
                          <div><span>Bank a/c</span><b>{ex.bank_account ?? "—"}</b></div>
                        </div>
                      )}
                      {r && key !== "decision" && <div className="detail">{r.summary}</div>}
                      {r && key !== "decision" && <Tags tags={r.tags} high />}
                    </div>
                  </li>
                );
              })}
            </ol>
            {live.error && <div className="err">Something went wrong: {live.error}</div>}
            {live.run && <Verdict run={live.run} />}
          </>
        )}
      </div>
    </div>
  );
}

function Verdict({ run }: { run: Run }) {
  const title = { Approve: "✅ Approved for payment", Review: "⚠️ Needs human review", Reject: "⛔ Rejected" }[run.decision];
  return (
    <div className={`verdict ${run.decision} ${run.priority === "high" ? "high" : ""}`}>
      <h3>{title}{run.priority === "high" && <span className="tag hi" style={{ marginLeft: 8 }}>HIGH PRIORITY</span>}</h3>
      <Tags tags={run.tags} high={run.priority === "high"} />
      <div style={{ marginTop: 8 }}>{run.reason}</div>
    </div>
  );
}

// ---------------- DASHBOARD ----------------
function Dashboard({ runs: all }: { runs: Run[] }) {
  const [filter, setFilter] = useState<string>("All");
  const [open, setOpen] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const runs = all.filter((r) => showHistory || !r.seeded);
  const tags = useMemo(() => [...new Set(runs.flatMap((r) => r.tags))], [runs]);
  const shown = runs.filter((r) =>
    filter === "All" ? true : ["Approve", "Review", "Reject"].includes(filter) ? r.decision === filter : filter === "High priority" ? r.priority === "high" : r.tags.includes(filter));
  const count = (d: string) => runs.filter((r) => r.decision === d).length;
  const autoAmt = runs.filter((r) => r.decision === "Approve").reduce((s, r) => s + (r.total ?? 0), 0);

  return (
    <>
      <div className="stats">
        <div className="stat"><div className="v">{runs.length}</div><div className="l">Invoices processed</div></div>
        <div className="stat"><div className="v" style={{ color: "var(--ok)" }}>{count("Approve")}</div><div className="l">Approved · {inr(autoAmt)}</div></div>
        <div className="stat"><div className="v" style={{ color: "var(--warn)" }}>{count("Review")}</div><div className="l">Waiting for review</div></div>
        <div className="stat"><div className="v" style={{ color: "var(--bad)" }}>{count("Reject")}</div><div className="l">Rejected</div></div>
        <div className="stat"><div className="v" style={{ color: "var(--bad)" }}>{runs.filter((r) => r.priority === "high").length}</div><div className="l">High priority</div></div>
      </div>
      <div className="filters">
        {["All", "Approve", "Review", "Reject", "High priority", ...tags].map((f) => (
          <button key={f} className={"chip" + (filter === f ? " on" : "")} onClick={() => setFilter(f)}>{f}</button>
        ))}
        <div className="spacer" />
        <label className="muted" style={{ fontSize: 13 }}><input type="checkbox" checked={showHistory} onChange={(e) => setShowHistory(e.target.checked)} /> show past history</label>
      </div>
      <div className="tablewrap">
        <table>
          <thead><tr><th>When</th><th>Vendor</th><th>Invoice #</th><th>PO</th><th className="num">Total</th><th>Decision</th><th>Tags</th></tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={7} className="empty">No runs yet — process an invoice first.</td></tr>}
            {shown.map((r) => (
              <FragmentRow key={r.id} r={r} open={open === r.id} toggle={() => setOpen(open === r.id ? null : r.id)} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function FragmentRow({ r, open, toggle }: { r: Run; open: boolean; toggle: () => void }) {
  return (
    <>
      <tr className={"row" + (r.priority === "high" ? " hirow" : "")} onClick={toggle}>
        <td className="muted">{new Date(r.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
        <td>{r.vendor_name ?? "—"}</td>
        <td>{r.invoice_number ?? "—"}</td>
        <td>{r.po_number ?? <span className="muted">none</span>}</td>
        <td className="num">{inr(r.total)}</td>
        <td><span className={"badge " + r.decision}>{r.decision}</span></td>
        <td><Tags tags={r.tags} high={r.priority === "high"} /></td>
      </tr>
      {open && (
        <tr className="expand"><td colSpan={7}>
          <div style={{ whiteSpace: "pre-wrap", marginBottom: 8 }}><b>Why:</b> {r.reason}</div>
          {r.stages?.length > 0 && (
            <ol className="steps">
              {r.stages.filter((s) => s.key !== "decision").map((s) => (
                <li key={s.key} className="step"><div className={"dot " + s.status}>{icon(s.status)}</div>
                  <div><div className="title">{s.label}</div><div className="detail">{s.summary}</div></div></li>
              ))}
            </ol>
          )}
          {r.file_name && <div className="muted" style={{ marginTop: 6 }}>File: {r.file_name}</div>}
        </td></tr>
      )}
    </>
  );
}

// ---------------- REFERENCE DATA ----------------
function RefData() {
  const [d, setD] = useState<{ vendors: Vendor[]; pos: PurchaseOrder[]; rules: any; error?: string } | null>(null);
  useEffect(() => { fetch("/api/data").then((r) => r.json()).then(setD); }, []);
  if (!d) return <div className="empty">Loading…</div>;
  if (d.error) return <div className="err">{d.error}</div>;
  const vname = (id: string) => d.vendors.find((v) => v.id === id)?.name ?? id;
  return (
    <div style={{ display: "grid", gap: 20 }}>
      <div className="panel">
        <h2>Rules</h2>
        <p className="sub">Set by the finance team. AI never changes these.</p>
        <div className="rules">
          <div className="stat"><div className="v">{d.rules.tolerancePct}%</div><div className="l">Price difference allowed…</div></div>
          <div className="stat"><div className="v">{inr(d.rules.toleranceCapInr)}</div><div className="l">…but never more than</div></div>
          <div className="stat"><div className="v">{d.rules.creepCount}×</div><div className="l">Small overcharges before "Vendor creep"</div></div>
          <div className="stat"><div className="v">{d.rules.creepWindowDays} days</div><div className="l">Look-back window</div></div>
        </div>
      </div>
      <div className="panel">
        <h2>Purchase orders</h2>
        <p className="sub">What Acme agreed to buy (before tax), and how much has been billed so far.</p>
        <div className="tablewrap"><table>
          <thead><tr><th>PO</th><th>Vendor</th><th>For</th><th className="num">PO value</th><th className="num">Already billed</th><th className="num">Remaining</th><th>Used</th></tr></thead>
          <tbody>{d.pos.map((p) => {
            const pct = Math.min(100, (p.invoiced / p.amount) * 100);
            return (
              <tr key={p.id}><td><b>{p.id}</b></td><td>{vname(p.vendor_id)}</td><td>{p.description}</td>
                <td className="num">{inr(p.amount)}</td><td className="num">{inr(p.invoiced)}</td><td className="num">{inr(p.amount - p.invoiced)}</td>
                <td><div className="bar"><i className={p.invoiced > p.amount ? "over" : pct >= 100 ? "full" : ""} style={{ width: pct + "%" }} /></div></td></tr>
            );
          })}</tbody>
        </table></div>
      </div>
      <div className="panel">
        <h2>Approved vendors</h2>
        <p className="sub">Only these companies can be paid. Bank details on file are what we compare every invoice against.</p>
        <div className="tablewrap"><table>
          <thead><tr><th>ID</th><th>Vendor</th><th>GSTIN</th><th>Bank</th><th>Account on file</th></tr></thead>
          <tbody>{d.vendors.map((v) => (
            <tr key={v.id}><td>{v.id}</td><td>{v.name}</td><td className="muted">{v.gstin}</td><td>{v.bank_name}</td><td>{v.bank_account}</td></tr>
          ))}</tbody>
        </table></div>
      </div>
    </div>
  );
}
