// Demo data: Acme Retail's approved vendor list, open purchase orders, and some past runs.
// "Reset demo data" in the app restores exactly this.
import type { PurchaseOrder, Run, Vendor } from "./types";

export const SEED_VENDORS: Vendor[] = [
  { id: "V001", name: "Dell India Pvt Ltd", gstin: "29AAACD1234F1Z5", bank_name: "HDFC Bank", bank_account: "50100234567891", ifsc: "HDFC0000123" },
  { id: "V002", name: "Urban Ladder Furniture Pvt Ltd", gstin: "29AADCU5566H1Z9", bank_name: "ICICI Bank", bank_account: "002105012345", ifsc: "ICIC0000021" },
  { id: "V003", name: "Amazon Web Services India Pvt Ltd", gstin: "29AAICA3918J1ZE", bank_name: "Citibank N.A.", bank_account: "0123456789", ifsc: "CITI0100000" },
  { id: "V004", name: "Swift Logistics Pvt Ltd", gstin: "29AAGCS7788L1Z3", bank_name: "State Bank of India", bank_account: "30112233445", ifsc: "SBIN0001234" },
  { id: "V005", name: "Quick Office Supplies", gstin: "29ABQPK4321M1Z7", bank_name: "Axis Bank", bank_account: "917020012345678", ifsc: "UTIB0000456" },
];

export const SEED_POS: PurchaseOrder[] = [
  { id: "PO-1023", vendor_id: "V001", description: "10 × Dell Latitude 5450 laptops", amount: 500000, invoiced: 0 },
  { id: "PO-1080", vendor_id: "V001", description: "6 × Dell 27\" monitors", amount: 120000, invoiced: 0 },
  { id: "PO-1045", vendor_id: "V002", description: "Office furniture - new floor fit-out", amount: 300000, invoiced: 0 },
  { id: "PO-1060", vendor_id: "V003", description: "AWS cloud - October 2026", amount: 240000, invoiced: 0 },
  { id: "PO-1069", vendor_id: "V004", description: "Freight - August 2026", amount: 50000, invoiced: 50450 },
  { id: "PO-1070", vendor_id: "V004", description: "Freight - September 2026", amount: 50000, invoiced: 50480 },
  { id: "PO-1071", vendor_id: "V004", description: "Freight - October 2026", amount: 50000, invoiced: 50470 },
  { id: "PO-1072", vendor_id: "V004", description: "Freight - November 2026", amount: 50000, invoiced: 0 },
  { id: "PO-1051", vendor_id: "V005", description: "Office stationery - Q4", amount: 48000, invoiced: 0 },
];

const daysAgo = (d: number) => new Date(Date.now() - d * 86400000).toISOString();

function pastRun(p: Partial<Run> & Pick<Run, "vendor_id" | "vendor_name" | "invoice_number" | "po_number" | "subtotal" | "reason">, ago: number): Omit<Run, "id"> {
  const subtotal = p.subtotal!;
  return {
    created_at: daysAgo(ago),
    file_name: null,
    invoice_date: null,
    tax: Math.round(subtotal * 0.18),
    total: Math.round(subtotal * 1.18),
    decision: "Approve",
    priority: "normal",
    tags: [],
    variance: null,
    within_tolerance: false,
    stages: [],
    extracted: null,
    seeded: true,
    ...p,
  } as Omit<Run, "id">;
}

// Swift Logistics has billed a little extra (but inside tolerance) for 3 months running.
export const SEED_RUNS: Omit<Run, "id">[] = [
  pastRun({ vendor_id: "V004", vendor_name: "Swift Logistics Pvt Ltd", invoice_number: "SLP/AUG/2026/071", po_number: "PO-1069", subtotal: 50450, variance: 450, within_tolerance: true,
    reason: "Approved. Billed ₹450 over PO-1069, within the allowed limit." }, 95),
  pastRun({ vendor_id: "V004", vendor_name: "Swift Logistics Pvt Ltd", invoice_number: "SLP/SEP/2026/088", po_number: "PO-1070", subtotal: 50480, variance: 480, within_tolerance: true,
    reason: "Approved. Billed ₹480 over PO-1070, within the allowed limit." }, 64),
  pastRun({ vendor_id: "V004", vendor_name: "Swift Logistics Pvt Ltd", invoice_number: "SLP/OCT/2026/097", po_number: "PO-1071", subtotal: 50470, variance: 470, within_tolerance: true,
    reason: "Approved. Billed ₹470 over PO-1071, within the allowed limit." }, 33),
];
