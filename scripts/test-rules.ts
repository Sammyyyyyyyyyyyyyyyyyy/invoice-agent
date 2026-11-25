// Runs every test invoice through the rules (with the values the AI should extract)
// and checks the decision + tags. No AI key or database needed.
import { evaluate, type Context } from "../lib/rules";
import { SEED_POS, SEED_RUNS, SEED_VENDORS } from "../lib/seed";
import type { Extracted, Run } from "../lib/types";

const base = (o: Partial<Extracted>): Extracted => ({
  vendor_name: null, vendor_gstin: null, invoice_number: null, invoice_date: null, po_number: null,
  line_items: [], subtotal: null, tax: null, total: null, bank_account: null, bank_ifsc: null, is_scanned: false, notes: null, ...o,
});
const li = (description: string, quantity: number, unit_price: number) => ({ description, quantity, unit_price, amount: quantity * unit_price });

const dell = { vendor_name: "Dell India Pvt Ltd", vendor_gstin: "29AAACD1234F1Z5", bank_account: "50100234567891" };
const ul = { vendor_name: "Urban Ladder Furniture Pvt Ltd", vendor_gstin: "29AADCU5566H1Z9", bank_account: "002105012345" };

const cases: [string, Extracted, string, string[]][] = [
  ["01 happy", base({ ...dell, invoice_number: "DI/2026/5567", po_number: "PO-1023", line_items: [li("Laptop", 10, 50000), li("Courier", 1, 300)], subtotal: 500300, tax: 90054, total: 590354 }), "Approve", []],
  ["02 split A", base({ ...ul, invoice_number: "UL-INV-8812", po_number: "PO-1045", line_items: [li("Chair", 30, 6000)], subtotal: 180000, tax: 32400, total: 212400 }), "Approve", []],
  ["03 split B", base({ ...ul, invoice_number: "UL-INV-8840", po_number: "PO-1045", line_items: [li("Desk", 10, 12000)], subtotal: 120000, tax: 21600, total: 141600 }), "Approve", []],
  ["04 split C", base({ ...ul, invoice_number: "UL-INV-8871", po_number: "PO-1045", line_items: [li("Chair lite", 10, 4500)], subtotal: 45000, tax: 8100, total: 53100 }), "Review", ["PO used"]],
  ["05 scan no PO", base({ vendor_name: "Quick Office Supplies", vendor_gstin: "29ABQPK4321M1Z7", bank_account: "917020012345678", invoice_number: "QOS/447", is_scanned: true, line_items: [li("Paper", 40, 900), li("Markers", 30, 400)], subtotal: 48000, tax: 8640, total: 56640 }), "Review", ["PO issues"]],
  ["06 bank changed", base({ vendor_name: "Amazon Web Services India Pvt Ltd", vendor_gstin: "29AAICA3918J1ZE", bank_account: "9912345678", invoice_number: "AWS-IN-2026-11-0931", po_number: "PO-1060", line_items: [li("AWS", 1, 240000)], subtotal: 240000, tax: 43200, total: 283200 }), "Review", ["Bank changed"]],
  ["07 vendor creep", base({ vendor_name: "Swift Logistics Pvt Ltd", vendor_gstin: "29AAGCS7788L1Z3", bank_account: "30112233445", invoice_number: "SLP/NOV/2026/112", po_number: "PO-1072", line_items: [li("Freight", 1, 50000), li("Fuel", 1, 490)], subtotal: 50490, tax: 9088.2, total: 59578.2 }), "Review", ["Vendor creep"]],
  ["08 duplicate", base({ ...dell, invoice_number: "DI-2026-5567", po_number: "PO-1023", line_items: [li("Laptop", 10, 50000), li("Courier", 1, 300)], subtotal: 500300, tax: 90054, total: 590354 }), "Reject", ["Duplicate invoice"]],
  ["09 tax wrong", base({ ...dell, invoice_number: "DI/2026/5602", po_number: "PO-1080", line_items: [li("Monitor", 6, 20000)], subtotal: 120000, tax: 21600, total: 143600 }), "Review", ["Review calc"]],
  ["10 invalid vendor", base({ vendor_name: "Zenith Traders", vendor_gstin: "29AAQFZ1122N1Z1", invoice_number: "ZT-2291", po_number: "PO-1023", line_items: [li("IT", 1, 85000)], subtotal: 85000, tax: 15300, total: 100300 }), "Reject", ["Invalid vendor"]],
];

// Simulate the app: run in order, approved invoices use up PO balance and become history.
const ctx: Context = {
  vendors: SEED_VENDORS,
  pos: SEED_POS.map((p) => ({ ...p })),
  runs: SEED_RUNS.map((r, i) => ({ ...r, id: "seed" + i })) as Run[],
};
let failed = 0;
for (const [name, inv, wantDecision, wantTags] of cases) {
  const out = evaluate(inv, ctx);
  const ok = out.decision === wantDecision && JSON.stringify(out.tags) === JSON.stringify(wantTags);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(18)} → ${out.decision} [${out.tags.join(", ")}]${ok ? "" : `   (expected ${wantDecision} [${wantTags.join(", ")}])`}`);
  if (process.env.VERBOSE) console.log("      " + out.reason.replace(/\n/g, "\n      "));
  if (out.decision === "Approve" && out.po) out.po && (ctx.pos.find((p) => p.id === out.po!.id)!.invoiced += out.poCharge);
  ctx.runs.push({ id: name, created_at: new Date().toISOString(), vendor_id: out.vendor?.id ?? null, vendor_name: inv.vendor_name, invoice_number: inv.invoice_number,
    invoice_date: null, po_number: inv.po_number, subtotal: inv.subtotal, tax: inv.tax, total: inv.total, decision: out.decision, priority: out.priority,
    tags: out.tags, reason: out.reason, variance: out.variance, within_tolerance: out.withinTolerance, stages: out.stages, extracted: inv, seeded: false });
}
console.log(failed ? `\n${failed} FAILED` : "\nAll cases pass.");
process.exit(failed ? 1 : 0);
