"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Extracted, PurchaseOrder, Run, StageResult, Vendor } from "@/lib/types";

const STAGES: [StageResult["key"], string][] = [
  ["read", "Read invoice"], ["vendor", "Vendor and bank details"], ["duplicate", "Duplicate check"], ["tax", "Totals and tax"],
  ["po", "Purchase order"], ["match", "Amount vs purchase order"], ["pattern", "Vendor billing history"],
];

const SAMPLE_GROUPS: { title: string; items: { f: string; n: string; h: string }[] }[] = [
  { title: "Happy path", items: [{ f: "01_happy_dell_laptops.pdf", n: "Dell India", h: "Laptops, slightly over PO" }] },
  {
    title: "Edge cases",
    items: [
      { f: "02_split_A_urbanladder.pdf", n: "Urban Ladder (1 of 3)", h: "Split order, first invoice" },
      { f: "03_split_B_urbanladder.pdf", n: "Urban Ladder (2 of 3)", h: "Split order, final balance" },
      { f: "04_split_C_urbanladder.pdf", n: "Urban Ladder (3 of 3)", h: "Split order, PO already billed" },
      { f: "05_scanned_no_po_quickoffice.pdf", n: "Quick Office Supplies", h: "Scanned, no PO reference" },
      { f: "06_bank_changed_aws.pdf", n: "Amazon Web Services", h: "New bank account requested" },
      { f: "07_vendor_creep_swift.pdf", n: "Swift Logistics", h: "Repeated small overcharges" },
    ],
  },
  {
    title: "Built-in checks",
    items: [
      { f: "08_duplicate_dell_laptops.pdf", n: "Dell India (again)", h: "Resubmitted invoice" },
      { f: "09_tax_wrong_dell_monitors.pdf", n: "Dell India", h: "Monitors, incorrect total" },
      { f: "10_invalid_vendor_zenith.pdf", n: "Zenith Traders", h: "Unknown vendor" },
    ],
  },
];
const SAMPLE_FILES = new Set(SAMPLE_GROUPS.flatMap((g) => g.items.map((i) => i.f)));

const inr = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : "₹" + (Math.round(n * 100) / 100).toLocaleString("en-IN", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
const icon = (s?: string) => ({ pass: "✓", warn: "!", fail: "✕", skip: "", running: "" } as Record<string, string>)[s ?? ""] ?? "";
const REJECT_TAGS = ["Invalid vendor", "Duplicate invoice"];
const STAMP = { Approve: ["APPROVED", "for payment"], Review: ["ON HOLD", "for review"], Reject: ["REJECTED", "do not pay"] } as const;
const TITLE = { Approve: "Approved for payment", Review: "On hold for review", Reject: "Rejected" } as const;
const NEXT: Record<string, string> = {
  Approve: "Schedule for the next payment run.",
  Reject: "Do not pay. Notify the vendor if required.",
  "Bank changed": "Confirm the new account with the vendor using contact details already on file.",
  "Review calc": "Request a corrected invoice from the vendor.",
  "PO issues": "Confirm the correct purchase order with the requester.",
  "PO used": "Confirm with the requester whether this is additional work; raise a new PO if so.",
  "Amount mismatch": "Confirm the additional amount with the requester.",
  "Vendor creep": "Review the billing pattern with the vendor before payment.",
  "Missing info": "Request a complete invoice from the vendor.",
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

  const [names, setNames] = useState<Record<string, string>>({});
  const loadNames = useCallback(() => {
    fetch("/api/names").then((r) => r.json()).then((d) => setNames(d.names ?? {})).catch(() => {});
  }, []);
  useEffect(() => { loadNames(); }, [loadNames]);
  async function rename(key: string, name: string) {
    setNames((n) => ({ ...n, [key]: name }));
    const r = await fetch("/api/names", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ key, name }) }).then((x) => x.json()).catch(() => null);
    if (r?.names) setNames(r.names);
  }

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
    setNames({});
    setSession((n) => n + 1); // clears the current run so you start fresh
    setView("process");
    setResetDone(true);
  }

  const live = runs.filter((r) => !r.seeded);
  const onHold = live.filter((r) => r.decision === "Review").length;
  const heads = {
    process: ["Process an invoice", "AI extracts the details. Your approval rules make the decision."],
    invoices: ["Invoices", "Every processed invoice and the reason for its decision."],
    data: ["Vendors, POs & rules", "Reference records used to check every invoice."],
  }[view];

  return (
    <div className="shell">
      <aside className="side">
        <a className="brand" href="/">
          <div className="brand-mark">A</div>
          <div><b>Invoice Agent</b><span>Acme Retail · Payables</span></div>
        </a>
        <nav className="nav">
          <button className={view === "process" ? "on" : ""} onClick={() => setView("process")}>Process invoice</button>
          <button className={view === "invoices" ? "on" : ""} onClick={() => { setView("invoices"); refresh(); }}>
            Invoices {onHold > 0 ? <span className="count hold" title="On hold for review">{onHold}</span> : <span className="count">{live.length}</span>}
          </button>
          <button className={view === "data" ? "on" : ""} onClick={() => setView("data")}>Vendors, POs & rules</button>
        </nav>
        <div className="side-foot">
          <p>Demo workspace: 5 vendors, 9 purchase orders.</p>
          <button onClick={() => setConfirmReset(true)} disabled={resetting}>{resetting ? "Resetting…" : "Reset demo data"}</button>
        </div>
      </aside>
      <div className="main">
        <header className="pagehead"><h1>{heads[0]}</h1><p>{heads[1]}</p></header>
        <div className="content">
          {view === "process" && <Process key={session} onDone={refresh} runs={runs} names={names} rename={rename} />}
          {view === "invoices" && <Invoices runs={runs} names={names} rename={rename} />}
          {view === "data" && <RefData />}
        </div>
      </div>
      {confirmReset && (
        <Modal onClose={() => setConfirmReset(false)}>
          <h2>Reset demo data?</h2>
          <p>Clears all processed invoices and restores vendors, purchase orders and history to their starting state.</p>
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
          <p>Invoices cleared. Vendors and purchase orders restored. Select an invoice to begin.</p>
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

type Namer = { names: Record<string, string>; rename: (key: string, name: string) => void };

/** Display name for an invoice: a rename if one exists, otherwise the file name without extension. */
const displayName = (names: Record<string, string>, key: string, fallback: string) => names[key] ?? fallback.replace(/\.[^.]+$/, "");

function Process({ onDone, runs, names, rename }: { onDone: () => void; runs: Run[] } & Namer) {
  const [live, setLive] = useState<Live | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);

  const [pending, setPending] = useState<File | null>(null);
  const [saveName, setSaveName] = useState("");

  function choose(f: File) {
    if (busy) return;
    setPending(f);
    setSaveName(f.name.replace(/\.[^.]+$/, ""));
  }

  const [queue, setQueue] = useState<{ total: number; done: number } | null>(null);

  // Bulk upload: no naming prompt; each file is checked in turn, exactly like a single upload.
  async function bulk(files: File[]) {
    if (busy) return;
    setQueue({ total: files.length, done: 0 });
    for (let i = 0; i < files.length; i++) {
      await process(files[i], undefined, { name: files[i].name });
      setQueue({ total: files.length, done: i + 1 });
    }
    setTimeout(() => setQueue(null), 4000);
  }

  function confirmUpload() {
    if (!pending) return;
    const ext = pending.name.match(/\.[^.]+$/)?.[0] ?? "";
    const name = (saveName.trim() || pending.name.replace(/\.[^.]+$/, "")) + ext;
    const f = pending;
    setPending(null);
    process(f, undefined, { name });
  }

  async function process(file: File, docUrl?: string, opts: { name?: string; sample?: boolean; path?: string } = {}) {
    setBusy(true);
    setLive({
      file: opts.name ?? file.name, docUrl: docUrl ?? URL.createObjectURL(file), isImage: file.type.startsWith("image/"),
      status: { read: "running" }, results: {}, extracted: null, run: null, error: null, note: null, model: null, ms: null,
    });
    const fd = new FormData();
    fd.append("file", file);
    fd.append("name", opts.name ?? file.name);
    if (opts.sample) fd.append("sample", "1");
    if (opts.path) fd.append("path", opts.path);
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
            if (ev.type === "saved") loadUploads();
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
    loadUploads();
  }

  const [uploads, setUploads] = useState<{ path: string; name: string; uploaded_at: string }[]>([]);
  const loadUploads = useCallback(() => {
    fetch("/api/uploads").then((r) => r.json()).then((d) => setUploads(d.uploads ?? [])).catch(() => {});
  }, []);
  useEffect(() => { loadUploads(); }, [loadUploads]);

  async function runUpload(u: { path: string; name: string }) {
    const res = await fetch("/api/file?path=" + encodeURIComponent(u.path));
    if (!res.ok) return;
    const blob = await res.blob();
    const f = new File([blob], u.name, { type: blob.type || "application/pdf" });
    process(f, undefined, { name: u.name, path: u.path });
  }

  async function runSample(f: string) {
    const blob = await fetch("/samples/" + f).then((r) => r.blob());
    process(new File([blob], f, { type: "application/pdf" }), "/samples/" + f, { sample: true });
  }

  return (
    <div className="work">
      <section className="pane">
        <div className="pane-h"><h2>New invoice</h2></div>
        <div className="pane-b">
          <label className={"upload" + (over ? " over" : "")}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); const fs = Array.from(e.dataTransfer.files); if (fs.length === 1) choose(fs[0]); else if (fs.length > 1) bulk(fs); }}>
            <b>Upload an invoice</b>PDF or image · you&rsquo;ll name it before checking
            <input type="file" accept="application/pdf,image/*" hidden disabled={busy}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) choose(f); e.target.value = ""; }} />
          </label>
          <label className={"upload bulk-up" + (busy ? " off" : "")}>
            <b>Bulk upload</b>Select several invoices at once · each is checked in turn
            <input type="file" accept="application/pdf,image/*" multiple hidden disabled={busy}
              onChange={(e) => { const fs = Array.from(e.target.files ?? []); if (fs.length === 1) choose(fs[0]); else if (fs.length > 1) bulk(fs); e.target.value = ""; }} />
          </label>
          {queue && (
            <div className={"bulk" + (queue.done === queue.total ? " done" : "")}>
              <b>{queue.done === queue.total ? `All ${queue.total} invoices checked` : `Checking ${queue.done + 1} of ${queue.total}`}</b>
              <div className="bar wide"><i style={{ width: (queue.done / queue.total) * 100 + "%" }} /></div>
              <span>Results appear on the Invoices page as each one finishes.</span>
            </div>
          )}
          {uploads.length > 0 && (
            <div className="group">
              <h3>Recent uploads <small>{uploads.length}</small></h3>
              <div className="uploads">
                {uploads.map((u) => {
                  const r = runs.find((x) => (x.extracted as any)?.file_path === u.path);
                  return (
                    <Item key={u.path} name={displayName(names, u.path, u.name)} sub={r ? `${r.vendor_name ?? "Uploaded invoice"} · ${TITLE[r.decision]}` : "Not checked yet"}
                      on={live?.file === u.name} disabled={busy} onRun={() => runUpload(u)} onRename={(n) => rename(u.path, n)} />
                  );
                })}
              </div>
            </div>
          )}
          {SAMPLE_GROUPS.map((g) => (
            <div className="group" key={g.title}>
              <h3>{g.title}</h3>
              {g.items.map((it) => (
                <Item key={it.f} name={displayName(names, it.f, it.n)} sub={it.h} on={live?.file === it.f} disabled={busy}
                  onRun={() => runSample(it.f)} onRename={(n) => rename(it.f, n)} />
              ))}
            </div>
          ))}
        </div>
      </section>

      {pending && (
        <Modal onClose={() => setPending(null)}>
          <h2>Save invoice as</h2>
          <p>Name this invoice so you can find it later on the Invoices page.</p>
          <form onSubmit={(e) => { e.preventDefault(); confirmUpload(); }}>
            <input className="field" autoFocus value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="e.g. Quick Office – November stationery" aria-label="Invoice name" />
            <p className="field-hint">File: {pending.name}</p>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setPending(null)}>Cancel</button>
              <button type="submit" className="btn primary" disabled={!saveName.trim()}>Save and check</button>
            </div>
          </form>
        </Modal>
      )}

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
            <div className="empty"><b>No invoice selected</b><br />Select an invoice to run the approval checks.</div>
          ) : (
            <>
              {live.run && <Decision run={live.run} />}
              {live.error && <div className="err">Processing stopped: {live.error}</div>}
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
                        {key === "read" && st === "running" && <p>{live.note ?? "Extracting invoice details…"}</p>}
                        {r && key !== "read" && <p>{r.summary}</p>}
                        {r && key === "read" && <p>{r.summary}</p>}
                        {r && <Tags tags={r.tags} high />}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

/** A row in the invoice list: click to check it, pencil to rename. */
function Item({ name, sub, on, disabled, onRun, onRename }: { name: string; sub: string; on?: boolean; disabled?: boolean; onRun: () => void; onRename: (n: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(name);
  if (editing) {
    return (
      <form className="item editing" onSubmit={(e) => { e.preventDefault(); if (val.trim()) onRename(val.trim()); setEditing(false); }}>
        <input className="field slim" autoFocus value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setEditing(false)} aria-label="Invoice name" />
        <div className="item-actions"><button type="button" className="btn sm" onClick={() => setEditing(false)}>Cancel</button><button type="submit" className="btn sm primary">Save</button></div>
      </form>
    );
  }
  return (
    <div className={"item" + (on ? " on" : "")}>
      <button className="sample" disabled={disabled} onClick={onRun}><b>{name}</b><span>{sub}</span></button>
      <button className="pencil" aria-label={`Rename ${name}`} title="Rename" onClick={() => { setVal(name); setEditing(true); }}>✎</button>
    </div>
  );
}

function Doc({ url, isImage, run, name }: { url?: string; isImage?: boolean; run: Run | null; name?: string }) {
  if (!url) {
    return (
      <div className="doc-empty">
        <div><div className="pick-arrow" aria-hidden>←</div><b>Select an invoice to check</b><p>Choose a test invoice or upload your own. The document appears here beside the checks for comparison.</p></div>
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

function InfoChecks({ stages }: { stages: StageResult[] }) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hover || pinned;
  const list = stages.filter((x) => x.key !== "decision");
  return (
    <span className="info" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button type="button" className="info-btn" aria-label="Show checks passed" aria-expanded={open} onClick={() => setPinned((o) => !o)} onBlur={() => setPinned(false)}>i</button>
      {open && (
        <span className="info-pop" role="tooltip">
          <b>{list.filter((x) => x.status === "pass").length} of {list.length} checks passed</b>
          {list.map((x) => (
            <span key={x.key} className="info-row"><i className={"mini " + x.status}>{icon(x.status)}</i><span><b>{x.label}</b>{x.summary}</span></span>
          ))}
        </span>
      )}
    </span>
  );
}

function Decision({ run }: { run: Run }) {
  const stages = run.stages ?? [];
  const get = (k: string) => stages.find((x) => x.key === k);
  const issues = stages.filter((x) => x.status === "warn" && x.key !== "decision");
  const failed = stages.find((x) => x.status === "fail" && x.key !== "decision");
  const next = run.decision === "Review" ? [...new Set(run.tags.map((t) => NEXT[t]).filter(Boolean))] : [NEXT[run.decision]];
  return (
    <div className={`decision ${run.decision}${run.priority === "high" ? " high" : ""}`}>
      <div className="d-head">
        <span className={"status " + run.decision}><i />{TITLE[run.decision]}</span>
        {run.priority === "high" && <span className="tag urgent">High priority</span>}
      </div>
      <dl className="d-rows">
        {run.decision === "Approve" && (
          <>
            {get("po") && <div><dt>Purchase order</dt><dd>{get("po")!.summary}</dd></div>}
            {get("match") && <div><dt>Amount</dt><dd>{get("match")!.summary}</dd></div>}
            <div><dt>Checks</dt><dd className="with-info">All checks passed. <InfoChecks stages={stages} /></dd></div>
          </>
        )}
        {run.decision === "Review" && issues.map((x) => (
          <div key={x.key}><dt><Tags tags={x.tags} high={run.priority === "high"} /></dt><dd>{x.summary}</dd></div>
        ))}
        {run.decision === "Reject" && failed && (
          <div><dt><Tags tags={failed.tags} /></dt><dd>{failed.summary}</dd></div>
        )}
        <div className="d-next"><dt>Next step</dt><dd>{next.join(" ")}</dd></div>
      </dl>
    </div>
  );
}

// ---------------- INVOICES (dashboard) ----------------
function Invoices({ runs: all, names, rename }: { runs: Run[] } & Namer) {
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
        <label className="toggle"><input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} /> Show earlier history</label>
      </div>
      <div className="table clickable">
        <table>
          <thead><tr><th>Vendor</th><th>Invoice no.</th><th>PO</th><th className="num">Total</th><th>Status</th><th>Flags</th><th>Processed</th></tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={7} className="empty">No invoices yet. Processed invoices appear here.</td></tr>}
            {shown.map((r) => (
              <tr key={r.id} className={r.priority === "high" ? "urgent-row" : ""} onClick={() => setOpen(r)}>
                <td className="vendor"><b>{r.vendor_name ?? "Unknown vendor"}</b><span>{keyOf(r) ? displayName(names, keyOf(r)!, r.file_name ?? "") : r.invoice_date ?? ""}</span></td>
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
      {open && <Drawer run={open} onClose={() => setOpen(null)} names={names} rename={rename} />}
    </>
  );
}

/** The key an invoice's display name is stored under: the test file name, or the upload's saved path. */
const keyOf = (r: Run) => (r.extracted as any)?.file_path ?? (r.file_name && SAMPLE_FILES.has(r.file_name) ? r.file_name : null);

function Drawer({ run, onClose, names, rename }: { run: Run; onClose: () => void } & Namer) {
  const [editing, setEditing] = useState(false);
  const key = keyOf(run);
  const label = key ? displayName(names, key, run.file_name ?? "") : run.invoice_number ?? "Invoice";
  const [val, setVal] = useState(label);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const fp = (run.extracted as any)?.file_path as string | undefined;
  const url = run.file_name && SAMPLE_FILES.has(run.file_name) ? "/samples/" + run.file_name : fp ? "/api/file?path=" + encodeURIComponent(fp) : undefined;
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="drawer" role="dialog" aria-label={`Invoice ${run.invoice_number ?? ""}`}>
        <div className="doc">
          {url ? <Doc url={url} run={run} name={run.file_name ?? undefined} /> : (
            <div className="doc-empty"><div><b>Original file not retained</b><p>Uploaded files are not stored in this demo. Extracted details are shown alongside.</p></div></div>
          )}
        </div>
        <div className="drawer-side">
          <div className="pane-h">
            {editing && key ? (
              <form className="rename-row" onSubmit={(e) => { e.preventDefault(); if (val.trim()) rename(key, val.trim()); setEditing(false); }}>
                <input className="field slim" autoFocus value={val} onChange={(e) => setVal(e.target.value)} aria-label="Invoice name" />
                <button type="submit" className="btn sm primary">Save</button>
              </form>
            ) : (
              <h2 className="dr-title">{label}{key && <button className="pencil inline" title="Rename" aria-label="Rename" onClick={() => { setVal(label); setEditing(true); }}>✎</button>}<small>{run.vendor_name} · {run.invoice_number}</small></h2>
            )}
            <button className="x" onClick={onClose} aria-label="Close">×</button>
          </div>
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
        <div className="pane-h"><h2>Approval rules</h2><small>Set by finance. Not changed by AI.</small></div>
        <div className="rules">
          <div><b>{d.rules.tolerancePct}%</b><span>Maximum amount over PO, as a percentage</span></div>
          <div><b>{inr(d.rules.toleranceCapInr)}</b><span>Maximum amount over PO, in rupees</span></div>
          <div><b>{d.rules.creepCount} times</b><span>Overcharges before a vendor is flagged</span></div>
          <div><b>{d.rules.creepWindowDays} days</b><span>Look-back period</span></div>
        </div>
      </section>
      <section className="pane">
        <div className="pane-h"><h2>Purchase orders</h2><small>Value before tax and amount billed to date</small></div>
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
        <div className="pane-h"><h2>Approved vendors</h2><small>Payments are made only to these vendors and accounts</small></div>
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
