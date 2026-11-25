import Link from "next/link";

const FLOW = [
  ["Invoice arrives", "A PDF or scanned image is uploaded, singly or in bulk."],
  ["AI reads it", "Gemini extracts vendor, GSTIN, invoice number, date, PO reference, line items, subtotal, tax, total and bank details."],
  ["Rules check it", "Seven fixed checks compare what was read against Acme's records: vendors, bank accounts, purchase orders and past invoices."],
  ["Decision", "Approve, hold for review or reject, with the reason and the next step written out."],
  ["People resolve the exceptions", "An AP reviewer approves or rejects on-hold invoices with a note. Every step is kept in the audit trail."],
];

const CHECKS = [
  ["Vendor and bank details", "Approved vendor list; bank account on file", "Unknown vendor → Reject (Invalid vendor). Different account → Review, high priority (Bank changed)."],
  ["Duplicate check", "Past invoices from the same vendor", "Same invoice number already processed → Reject (Duplicate invoice)."],
  ["Totals and tax", "The invoice's own figures", "Line items ≠ subtotal, or subtotal + tax ≠ total → Review (Review calc)."],
  ["Purchase order", "PO list", "Missing, unknown or another vendor's PO → Review (PO issues), with the likely PO suggested."],
  ["Amount vs purchase order", "What is left on the PO", "PO fully billed → Review (PO used). Over by more than the limit → Review (Amount mismatch)."],
  ["Vendor billing history", "Approved invoices in the last 120 days", "Third or later small overcharge → Review (Vendor creep)."],
];

const DECISIONS = [
  ["AI reads, rules decide", "AI is good at messy documents and bad at being auditable. Extraction uses AI; the payment decision uses written rules, so the same invoice always gets the same answer and every outcome can be explained."],
  ["Three outcomes, not two", "Clear cases are handled automatically; anything uncertain goes to a person. Payments are too costly to guess on."],
  ["Reject only when it can't be valid", "Unknown vendors and exact duplicates are rejected. Everything else that might be fixable is held, so good vendors aren't penalised for a typo."],
  ["Compare before tax", "POs are agreed on pre-tax value and GST rates vary by item. The subtotal is matched to the PO; tax is verified separately, which also catches inflated tax."],
  ["Tolerance: 1%, capped at ₹5,000", "Chasing a ₹300 difference costs more than ₹300. Risk scales with money, so the limit is a percentage with a rupee ceiling. Finance can change both."],
  ["Match against what's left on the PO", "Vendors often split one order across several invoices. Checking the remaining balance catches over-billing that a per-invoice check would miss."],
  ["Look at patterns, not just single invoices", "Small overcharges stay under any single-invoice limit. Counting them per vendor over time catches slow leakage."],
  ["Bank changes are always high priority", "Vendor impersonation looks like a perfectly normal invoice with a new account number. It is never auto-approved, whatever else matches."],
  ["Show every problem at once", "Rejections stop immediately, but all review issues are collected, so a reviewer never handles the same invoice twice."],
  ["Plan for the AI being unavailable", "If a model is busy, the app retries and falls back to other models automatically, so the queue isn't blocked."],
];

const ASSUMPTIONS = [
  "All amounts are in Indian rupees, and invoices carry GST.",
  "PO amounts are agreed values before tax.",
  "Each invoice bills against one purchase order.",
  "Vendors are identified by GSTIN first, then by name.",
  "A manual check takes about 10 minutes per invoice (used for the time-saved figure).",
  "Only approved invoices reduce a PO's remaining balance.",
  "Vendors, POs and history are demo data for a fictional company, Acme Retail.",
];

const NEXT = [
  ["Email intake", "Read invoices straight from the AP inbox instead of uploading them."],
  ["ERP sync", "Pull vendors and purchase orders from Tally, Zoho Books or SAP, and push approved invoices back for payment."],
  ["Three-way match", "Add goods-received notes, so payment only happens for what was actually delivered."],
  ["Learning from reviewers", "Use reviewer decisions to suggest better tolerances per vendor and reduce false holds."],
  ["Roles and approvals", "Approval limits by amount, and sign-in so the audit trail records real users."],
  ["Multi-currency and multi-PO invoices", "Support foreign vendors and invoices that span several POs."],
];

export default function How() {
  return (
    <div className="home how">
      <header className="home-top">
        <Link href="/" className="brand dark"><div className="brand-mark">A</div><div><b>Invoice Agent</b><span>Accounts payable, checked</span></div></Link>
        <nav className="how-nav"><Link href="/">← Home</Link><Link href="/app" className="btn primary">Open workspace</Link></nav>
      </header>

      <section className="home-sec how-hero">
        <h1>How it works</h1>
        <p className="lede">The design choices behind Invoice Agent, the assumptions it makes, and what would come next in production.</p>
        <div className="toc">
          <a href="#flow">The flow</a><a href="#checks">The checks</a><a href="#decisions">Design decisions</a><a href="#assumptions">Assumptions</a><a href="#next">What&rsquo;s next</a>
        </div>
      </section>

      <section className="home-sec" id="flow">
        <h2>The flow</h2>
        <ol className="flow">
          {FLOW.map(([t, d], i) => <li key={t}><span className="n">{i + 1}</span><div><h3>{t}</h3><p>{d}</p></div></li>)}
        </ol>
      </section>

      <section className="home-sec" id="checks">
        <h2>The checks</h2>
        <p className="sec-sub">Each check compares the extracted invoice against one of Acme&rsquo;s records.</p>
        <div className="table"><table>
          <thead><tr><th>Check</th><th>Compared against</th><th>When it flags</th></tr></thead>
          <tbody>{CHECKS.map(([a, b, c]) => <tr key={a}><td><b>{a}</b></td><td>{b}</td><td>{c}</td></tr>)}</tbody>
        </table></div>
      </section>

      <section className="home-sec" id="decisions">
        <h2>Design decisions</h2>
        <div className="decisions">
          {DECISIONS.map(([t, d]) => <div key={t}><h3>{t}</h3><p>{d}</p></div>)}
        </div>
      </section>

      <section className="home-sec two" id="assumptions">
        <div>
          <h2>Assumptions</h2>
          <ul className="plain">{ASSUMPTIONS.map((a) => <li key={a}>{a}</li>)}</ul>
        </div>
        <div id="next">
          <h2>What&rsquo;s next in production</h2>
          <ul className="plain">{NEXT.map(([t, d]) => <li key={t}><b>{t}.</b> {d}</li>)}</ul>
        </div>
      </section>

      <section className="home-sec">
        <Link href="/app" className="cta">Try it in the workspace <span aria-hidden>→</span></Link>
      </section>
      <footer className="home-foot">Built by Shambhavi KM · Zamp AI Solutions Associate case study, 2026</footer>
    </div>
  );
}
