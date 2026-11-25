"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Extracted, PurchaseOrder, Run, StageResult, Vendor } from "@/lib/types";

const STAGES: [StageResult["key"], string][] = [
  ["read", "Read invoice"], ["vendor", "Check vendor"], ["duplicate", "Check for duplicates"], ["tax", "Check the maths"],
  ["po", "Find purchase order"], ["match", "Match amount to PO"], ["pattern", "Check vendor history"],
];

const SAMPLE_GROUPS: { title: string; items: { f: string; n: string; h: string }[] }[] = [
  { title: "Happy path", items: [{ f: "01_happy_dell_laptops.pdf", n: "Dell India", h: "Laptops, ₹300 over PO" }] },
  {
    title: "Edge cases",
    items: [
      { f: "02_split_A_urbanladder.pdf", n: "Urban Ladder (1 of 3)", h: "First part of a split order" },
      { f: "03_split_B_urbanladder.pdf", n: "Urban Ladder (2 of 3)", h: "Uses up the rest of the PO" },
      { f: "04_split_C_urbanladder.pdf", n: "Urban Ladder (3 of 3)", h: "Nothing left on the PO" },
      { f: "05_scanned_no_po_quickoffice.pdf", n: "Quick Office Supplies", h: "Scanned, no PO number" },
      { f: "06_bank_changed_aws.pdf", n: "Amazon Web Services", h: "Asks to pay a new bank account" },
      { f: "07_vendor_creep_swift.pdf", n: "Swift Logistics", h: "4th small overcharge in a row" },
    ],
  },
  {
    title: "Built-in checks",
    items: [
      { f: "08_duplicate_dell_laptops.pdf", n: "Dell India (again)", h: "Same invoice sent twice" },
      { f: "09_tax_wrong_dell_monitors.pdf", n: "Dell India", h: "Monitors, total doesn't add up" },
      { f: "10_invalid_vendor_zenith.pdf", n: "Zenith Traders", h: "Not an approved vendor" },
    ],
  },
];
const SAMPLE_FILES = new Set(SAMPLE_GROUPS.flatMap((g) => g.items.map((i) => i.f)));

const inr = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : "₹" + (Math.round(n * 100) / 100).toLocaleString("en-IN", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
const icon = (s?: string) => ({ pass: "✓", warn: "!", fail: "✕", skip: "", running: "" } as Record<string, string>)[s ?? ""] ?? "";
const REJECT_TAGS = ["Invalid vendor", "Duplicate invoice"];
const STAMP = { Approve: ["APPROVED", "for payment"], Review: ["ON HOLD", "needs review"], Reject: ["REJECTED", "do not pay"] } as const;
const TITLE = { Approve: "Approved for payment", Review: "Needs review", Reject: "Rejected" } as const;
const NEXT: Record<string, string> = {
  Approve: "Queue for the next payment run. No action needed.",
  Reject: "Don't pay. Reply to the sender if needed.",
  "Bank changed": "Call the vendor on a number you already have (not one from this invoice) to confirm the new account.",
  "Review calc": "Ask the vendor for a corrected invoice.",
  "PO issues": "Confirm which PO this belongs to, or ask the vendor to add the PO number.",
  "PO used": "Check with the buyer whether this was extra work, and raise a new PO if so.",
  "Amount mismatch": "Ask the buyer whether the extra amount was agreed.",
  "Vendor creep": "Raise the pattern with the vendor before paying.",
  "Missing info": "Ask the vendor to resend a complete invoice.",
};
const when = (s: string) => new Date(s).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function Tags({ tags, high }: { tags: string[]; high?: boolean }) {
  if (!tags.length) return null;
  return (
    <div className="tags">
      {tags.map((t) => <span key={t} className={"tag" + (t === "Bank changed" && high ? " urgent" : REJECT_TAGS.includes(t) ? " bad" : "")}>{t}</span>)}
    </div>
  );
}

export default function Home() {
  const [view, setView] = useState<"process" | "invoices" | "data">("process");
  const [runs, setRuns] = useState<Run[]>([]);
  const [resetting, setResetting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const [session, setSession] = useState(0);

  const refresh = useCallback(async () => {
    const r = await fetch("/api/runs").then((x) => x.json()).catch(() => ({ runs: [] }));
    setRuns(r.runs ?? []);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  async function reset() {
    setConfirmReset(false);
    setResetting(true);
    await fetch("/api/reset", { method: "POST" });
    await refresh();
    setResetting(false);
    setSession((n) => n + 1); // clears the current run so you start fresh
    setView("process");
    setResetDone(true);
  }

  const live = runs.filter((r) => !r.seeded);
  const onHold = live.filter((r) => r.decision === "Review").length;
  const heads = {
    process: ["Process an invoice", "Upload a bill. AI reads it, your rules decide."],
    invoices: ["Invoices", "Everything processed, with the reason for each decision."],
    data: ["Vendors, POs & rules", "The records every invoice is checked against."],
  }[view];

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <div className="brand-mark">A</div>
          <div><b>Invoice Agent</b><span>Acme Retail · Payables</span></div>
        </div>
        <nav className="nav">
          <button className={view === "process" ? "on" : ""} onClick={() => setView("process")}>Process invoice</button>
          <button className={view === "invoices" ? "on" : ""} onClick={() => { setView("invoices"); refresh(); }}>
            Invoices {onHold > 0 ? <span className="count hold" title="On hold for review">{onHold}</span> : <span className="count">{live.length}</span>}
          </button>
          <button className={view === "data" ? "on" : ""} onClick={() => setView("data")}>Vendors, POs & rules</button>
        </nav>
        <div className="side-foot">
          <p>Demo company with 5 vendors and 9 purchase orders.</p>
          <button onClick={() => setConfirmReset(true)} disabled={resetting}>{resetting ? "Resetting…" : "Reset demo data"}</button>
        </div>
      </aside>
      <div className="main">
        <header className="pagehead"><h1>{heads[0]}</h1><p>{heads[1]}</p></header>
        <div className="content">
          {view === "process" && <Process key={session} onDone={refresh} />}
          {view === "invoices" && <Invoices runs={runs} />}
          {view === "data" && <RefData />}
        </div>
      </div>
      {confirmReset && (
        <Modal onClose={() => setConfirmReset(false)}>
          <h2>Reset demo data?</h2>
          <p>This clears every processed invoice and restores the vendor list, purchase orders and past history to their starting state.</p>
          <div className="modal-actions">
            <button className="btn" onClick={() => setConfirmReset(false)}>Cancel</button>
            <button className="btn primary" onClick={reset}>Reset demo data</button>
          </div>
        </Modal>
      )}
      {resetDone && (
        <Modal onClose={() => setResetDone(false)}>
          <div className="modal-ok">✓</div>
          <h2>Demo data reset</h2>
          <p>All invoices cleared. 5 vendors and 9 purchase orders are back to their starting state. Pick an invoice to check.</p>
          <div className="modal-actions"><button className="btn primary" onClick={() => setResetDone(false)}>Done</button></div>
        </Modal>
      )}
    </div>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true">{children}</div>
    </>
  );
}

// ---------------- PROCESS (live run) ----------------
type Live = {
  file: string; docUrl: string; isImage: boolean;
  status: Record<string, string>; results: Record<string, StageResult>;
  extracted: Extracted | null; run: Run | null; error: string | null;
  note: string | null; model: string | null; ms: number | null;
};

function Process({ onDone }: { onDone: () => void }) {
  const [live, setLive] = useState<Live | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);

  async function process(file: File, docUrl?: string) {
    setBusy(true);
    setLive({
      file: file.name, docUrl: docUrl ?? URL.createObjectURL(file), isImage: file.type.startsWith("image/"),
      status: { read: "running" }, results: {}, extracted: null, run: null, error: null, note: null, model: null, ms: null,
    });
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/process", { method: "POST", body: fd });
      if (!res.body) throw new Error("No response from the server.");
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
            if (ev.type === "note") n.note = ev.message;
            if (ev.type === "extracted") { n.extracted = ev.extracted; n.model = ev.model; n.ms = ev.ms; n.note = null; }
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
    process(new File([blob], f, { type: "application/pdf" }), "/samples/" + f);
  }

  return (
    <div className="work">
      <section className="pane">
        <div className="pane-h"><h2>New invoice</h2></div>
        <div className="pane-b">
          <label className={"upload" + (over ? " over" : "")}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f && !busy) process(f); }}>
            <b>Upload an invoice</b>PDF, scan or photo
            <input type="file" accept="application/pdf,image/*" hidden disabled={busy}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) process(f); e.target.value = ""; }} />
          </label>
          {SAMPLE_GROUPS.map((g) => (
            <div className="group" key={g.title}>
              <h3>{g.title}</h3>
              {g.items.map((s) => (
                <button key={s.f} className={"sample" + (live?.file === s.f ? " on" : "")} disabled={busy} onClick={() => runSample(s.f)}>
                  <b>{s.n}</b><span>{s.h}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section className="pane doc">
        <Doc url={live?.docUrl} isImage={live?.isImage} run={live?.run ?? null} name={live?.file} />
      </section>

      <section className="pane">
        <div className="pane-h">
          <h2>Checks</h2>
          {live?.model && <small>Read by {live.model} in {((live.ms ?? 0) / 1000).toFixed(1)}s</small>}
        </div>
        <div className="pane-b">
          {!live ? (
            <div className="empty"><b>No invoice selected</b><br />Choose one on the left and each check will run here, step by step.</div>
          ) : (
            <>
              {live.extracted && <Fields ex={live.extracted} />}
              <ol className="checks">
                {STAGES.map(([key, label]) => {
                  const st = live.status[key];
                  const r = live.results[key];
                  return (
                    <li key={key} className={"check" + (st ? "" : " idle")}>
                      <div className={"dot " + (st ?? "")}>{icon(st)}</div>
                      <div>
                        <h4>{label}</h4>
                        {key === "read" && st === "running" && <p>{live.note ?? "AI is reading the document…"}</p>}
                        {r && key !== "read" && <p>{r.summary}</p>}
                        {r && key === "read" && <p>{r.summary}</p>}
                        {r && <Tags tags={r.tags} high />}
                      </div>
                    </li>
                  );
                })}
              </ol>
              {live.error && <div className="err">The run stopped: {live.error}</div>}
              {live.run && <Decision run={live.run} />}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function Doc({ url, isImage, run, name }: { url?: string; isImage?: boolean; run: Run | null; name?: string }) {
  if (!url) {
    return (
      <div className="doc-empty">
        <div><div className="pick-arrow" aria-hidden>←</div><b>Select an invoice to check</b><p>Pick one of the test invoices on the left, or upload your own. It opens here next to the checks so you can compare.</p></div>
      </div>
    );
  }
  return (
    <div className="doc-frame">
      {isImage ? <img src={url} alt={name ?? "Invoice"} /> : <iframe src={url + "#toolbar=0&navpanes=0&view=FitH"} title={name ?? "Invoice"} />}
      {run && (
        <div className={"stamp " + run.decision} role="status">
          {STAMP[run.decision][0]}<small>{STAMP[run.decision][1]}</small>
        </div>
      )}
    </div>
  );
}

function Fields({ ex }: { ex: Extracted }) {
  return (
    <dl className="fields">
      <div className="wide"><dt>Vendor</dt><dd>{ex.vendor_name ?? "—"}</dd></div>
      <div><dt>Invoice no.</dt><dd>{ex.invoice_number ?? "—"}</dd></div>
      <div><dt>Date</dt><dd>{ex.invoice_date ?? "—"}</dd></div>
      <div><dt>PO</dt><dd>{ex.po_number ?? <span className="muted">Not on invoice</span>}</dd></div>
      <div><dt>Bank account</dt><dd>{ex.bank_account ?? "—"}</dd></div>
      <div><dt>Subtotal</dt><dd className="num">{inr(ex.subtotal)}</dd></div>
      <div><dt>Tax</dt><dd className="num">{inr(ex.tax)}</dd></div>
      <div className="wide"><dt>Total payable</dt><dd className="num">{inr(ex.total)}</dd></div>
    </dl>
  );
}

function Decision({ run }: { run: Run }) {
  const steps = run.decision === "Review" ? run.tags.map((t) => NEXT[t]).filter(Boolean) : [NEXT[run.decision]];
  return (
    <div className={`decision ${run.decision}${run.priority === "high" ? " high" : ""}`}>
      <h3>{TITLE[run.decision]}{run.priority === "high" && <span className="tag urgent">High priority</span>}</h3>
      <Tags tags={run.tags} high={run.priority === "high"} />
      <div className="why">{run.reason}</div>
      <div className="next"><b>What to do next: </b>{steps.join(" ")}</div>
    </div>
  );
}

// ---------------- INVOICES (dashboard) ----------------
function Invoices({ runs: all }: { runs: Run[] }) {
  const [seg, setSeg] = useState<"All" | "Review" | "Approve" | "Reject">("All");
  const [tag, setTag] = useState<string | null>(null);
  const [history, setHistory] = useState(false);
  const [open, setOpen] = useState<Run | null>(null);

  const runs = all.filter((r) => history || !r.seeded);
  const tags = useMemo(() => [...new Set(runs.flatMap((r) => r.tags))], [runs]);
  const shown = runs.filter((r) => (seg === "All" || r.decision === seg) && (!tag || r.tags.includes(tag)));
  const n = (d: string) => runs.filter((r) => r.decision === d).length;
  const approvedAmt = runs.filter((r) => r.decision === "Approve").reduce((s, r) => s + (r.total ?? 0), 0);
  const heldAmt = runs.filter((r) => r.decision === "Review").reduce((s, r) => s + (r.total ?? 0), 0);

  return (
    <>
      <div className="summary">
        <div><b>{runs.length}</b><span>Invoices processed</span></div>
        <div><b style={{ color: "var(--ok)" }}>{n("Approve")}</b><span>Approved · {inr(approvedAmt)}</span></div>
        <div><b style={{ color: "var(--hold)" }}>{n("Review")}</b><span>On hold · {inr(heldAmt)}</span></div>
        <div><b style={{ color: "var(--bad)" }}>{n("Reject")}</b><span>Rejected</span></div>
        <div><b style={{ color: "var(--bad)" }}>{runs.filter((r) => r.priority === "high").length}</b><span>High priority</span></div>
      </div>
      <div className="toolbar">
        <div className="seg">
          {(["All", "Review", "Approve", "Reject"] as const).map((s) => (
            <button key={s} className={seg === s ? "on" : ""} onClick={() => setSeg(s)}>
              {s === "All" ? "All" : s === "Review" ? "On hold" : s === "Approve" ? "Approved" : "Rejected"}
            </button>
          ))}
        </div>
        <div className="tagfilter">
          {tags.map((t) => <button key={t} className={tag === t ? "on" : ""} onClick={() => setTag(tag === t ? null : t)}>{t}</button>)}
        </div>
        <label className="toggle"><input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} /> Include past months</label>
      </div>
      <div className="table clickable">
        <table>
          <thead><tr><th>Vendor</th><th>Invoice no.</th><th>PO</th><th className="num">Total</th><th>Status</th><th>Flags</th><th>Processed</th></tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={7} className="empty">No invoices here yet. Process one to see it listed.</td></tr>}
            {shown.map((r) => (
              <tr key={r.id} className={r.priority === "high" ? "urgent-row" : ""} onClick={() => setOpen(r)}>
                <td className="vendor"><b>{r.vendor_name ?? "Unknown vendor"}</b><span>{r.invoice_date ?? ""}</span></td>
                <td>{r.invoice_number ?? "—"}</td>
                <td>{r.po_number ?? <span className="muted">None</span>}</td>
                <td className="num">{inr(r.total)}</td>
                <td><span className={"status " + r.decision}><i />{TITLE[r.decision]}</span></td>
                <td><Tags tags={r.tags} high={r.priority === "high"} /></td>
                <td className="muted">{when(r.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && <Drawer run={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function Drawer({ run, onClose }: { run: Run; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const url = run.file_name && SAMPLE_FILES.has(run.file_name) ? "/samples/" + run.file_name : undefined;
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="drawer" role="dialog" aria-label={`Invoice ${run.invoice_number ?? ""}`}>
        <div className="doc">
          {url ? <Doc url={url} run={run} name={run.file_name ?? undefined} /> : (
            <div className="doc-empty"><div><b>Original file not stored</b><p>Uploaded files aren't kept in this demo. The extracted details are on the right.</p></div></div>
          )}
        </div>
        <div className="drawer-side">
          <div className="pane-h"><h2>{run.vendor_name ?? "Invoice"} · {run.invoice_number ?? ""}</h2><button className="x" onClick={onClose} aria-label="Close">×</button></div>
          <div className="pane-b">
            {run.extracted && <Fields ex={run.extracted} />}
            <Decision run={run} />
            {run.stages?.length > 0 && (
              <ol className="checks" style={{ marginTop: 16 }}>
                {run.stages.filter((s) => s.key !== "decision").map((s) => (
                  <li key={s.key} className="check"><div className={"dot " + s.status}>{icon(s.status)}</div>
                    <div><h4>{s.label}</h4><p>{s.summary}</p></div></li>
                ))}
              </ol>
            )}
            <p className="note">Processed {when(run.created_at)}{run.file_name ? ` · ${run.file_name}` : ""}</p>
          </div>
        </div>
      </div>
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
    <div className="ref">
      <section className="pane">
        <div className="pane-h"><h2>Approval rules</h2><small>Set by finance. The AI can't change these.</small></div>
        <div className="rules">
          <div><b>{d.rules.tolerancePct}%</b><span>Price difference allowed over the PO…</span></div>
          <div><b>{inr(d.rules.toleranceCapInr)}</b><span>…up to this amount at most</span></div>
          <div><b>{d.rules.creepCount} times</b><span>Small overcharges before a vendor is flagged</span></div>
          <div><b>{d.rules.creepWindowDays} days</b><span>How far back we look</span></div>
        </div>
      </section>
      <section className="pane">
        <div className="pane-h"><h2>Purchase orders</h2><small>Agreed value before tax, and how much has been billed so far</small></div>
        <div className="table" style={{ border: 0, borderRadius: 0 }}><table>
          <thead><tr><th>PO</th><th>Vendor</th><th>For</th><th className="num">Value</th><th className="num">Billed</th><th className="num">Remaining</th><th>Used</th></tr></thead>
          <tbody>{d.pos.map((p) => {
            const pct = Math.min(100, (p.invoiced / p.amount) * 100);
            return (
              <tr key={p.id}><td><b>{p.id}</b></td><td>{vname(p.vendor_id)}</td><td>{p.description}</td>
                <td className="num">{inr(p.amount)}</td><td className="num">{inr(p.invoiced)}</td><td className="num">{inr(Math.max(0, p.amount - p.invoiced))}</td>
                <td><div className="bar"><i className={pct >= 100 ? "full" : ""} style={{ width: pct + "%" }} /></div></td></tr>
            );
          })}</tbody>
        </table></div>
      </section>
      <section className="pane">
        <div className="pane-h"><h2>Approved vendors</h2><small>Only these companies can be paid, and only to the account on file</small></div>
        <div className="table" style={{ border: 0, borderRadius: 0 }}><table>
          <thead><tr><th>Vendor</th><th>GSTIN</th><th>Bank</th><th className="num">Account on file</th></tr></thead>
          <tbody>{d.vendors.map((v) => (
            <tr key={v.id}><td><b>{v.name}</b></td><td className="muted">{v.gstin}</td><td>{v.bank_name}</td><td className="num">{v.bank_account}</td></tr>
          ))}</tbody>
        </table></div>
      </section>
    </div>
  );
}
