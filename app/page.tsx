import Link from "next/link";

const STEPS = [
  { t: "Reads the invoice", d: "AI extracts vendor, invoice number, PO reference, line items, tax, totals and bank details from any PDF or scanned bill." },
  { t: "Checks it against your records", d: "Approved vendors, bank accounts on file, purchase order balances, previous invoices and the vendor's billing history." },
  { t: "Decides and explains", d: "Approve, hold for review or reject, with the reason in plain language and the next step for your team." },
];

const CATCHES = [
  ["Invalid vendor", "Invoices from companies that were never onboarded."],
  ["Duplicate invoice", "The same bill submitted twice, even with a reformatted number."],
  ["Bank changed", "A request to pay a different account. Flagged as high priority."],
  ["Review calc", "Line items, tax and totals that don't reconcile."],
  ["PO issues", "Missing or wrong PO reference, with the likely match suggested."],
  ["PO used", "Billing against a purchase order that is already fully paid."],
  ["Amount mismatch", "Charges beyond the allowed difference from the PO."],
  ["Vendor creep", "Small overcharges that repeat across months."],
];

export default function Home() {
  return (
    <div className="home">
      <header className="home-top">
        <div className="brand dark"><div className="brand-mark">A</div><div><b>Invoice Agent</b><span>Accounts payable, checked</span></div></div>
        <nav className="how-nav"><Link href="/how">How it works</Link><Link href="/app" className="btn primary">Open workspace</Link></nav>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <h1>Every invoice checked before it&rsquo;s paid.</h1>
          <p className="lede">
            Invoice Agent reads vendor invoices, checks them against your purchase orders and approval rules, and tells your team what to
            pay, what to hold and why.
          </p>
          <Link href="/app" className="cta">Get started <span aria-hidden>→</span></Link>
          <p className="fine">Demo workspace for Acme Retail with 5 vendors, 9 purchase orders and 10 test invoices. <Link href="/how">See how it works and the design decisions</Link>.</p>
        </div>
        <div className="hero-art" aria-hidden>
          <div className="mock-inv">
            <div className="mi-head"><b>Dell India Pvt Ltd</b><span>TAX INVOICE</span></div>
            <div className="mi-meta"><span>Invoice DI/2026/5567</span><span>PO-1023</span></div>
            <div className="mi-line"><span>Latitude 5450 laptop × 10</span><span>₹5,00,000</span></div>
            <div className="mi-line"><span>Courier &amp; handling</span><span>₹300</span></div>
            <div className="mi-tot"><span>Total payable</span><b>₹5,90,354</b></div>
            <div className="mi-bank"><b>Bank details</b><span>HDFC Bank · A/c 50100234567891</span><span>IFSC HDFC0000123</span></div>
            <div className="stamp Approve static">APPROVED<small>for payment</small></div>
          </div>
          <div className="mock-checks">
            {["Vendor and bank details", "Duplicate check", "Totals and tax", "Amount vs purchase order"].map((c) => (
              <div key={c}><i>✓</i>{c}</div>
            ))}
          </div>
        </div>
      </section>

      <section className="home-sec">
        <h2>What it does</h2>
        <ol className="steps3">
          {STEPS.map((s, i) => (
            <li key={s.t}><span className="n">{i + 1}</span><h3>{s.t}</h3><p>{s.d}</p></li>
          ))}
        </ol>
      </section>

      <section className="home-sec">
        <h2>What it catches</h2>
        <p className="sec-sub">AI reads the document; fixed rules make the decision, so every outcome can be explained and audited.</p>
        <div className="catches">
          {CATCHES.map(([t, d]) => (
            <div key={t}><span className={"tag" + (t === "Invalid vendor" || t === "Duplicate invoice" ? " bad" : t === "Bank changed" ? " urgent" : "")}>{t}</span><p>{d}</p></div>
          ))}
        </div>
        <div className="cta-row"><Link href="/app" className="cta">Get started <span aria-hidden>→</span></Link><Link href="/how" className="cta ghost">How it works</Link></div>
      </section>

      <footer className="home-foot">Built by Shambhavi KM · Zamp AI Solutions Associate case study, 2026</footer>
    </div>
  );
}
