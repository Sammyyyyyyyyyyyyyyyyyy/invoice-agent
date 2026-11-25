// Shared shapes used across the app.

export type LineItem = {
  description: string;
  quantity: number | null;
  unit_price: number | null;
  amount: number | null;
};

/** What the AI reads off the invoice. Any field can be null if it isn't on the page. */
export type Extracted = {
  vendor_name: string | null;
  vendor_gstin: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  po_number: string | null;
  line_items: LineItem[];
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  bank_account: string | null;
  bank_ifsc: string | null;
  is_scanned: boolean;
  notes: string | null;
};

export type Vendor = {
  id: string;
  name: string;
  gstin: string;
  bank_name: string;
  bank_account: string;
  ifsc: string;
};

export type PurchaseOrder = {
  id: string;
  vendor_id: string;
  description: string;
  amount: number; // agreed value before tax
  invoiced: number; // how much has already been billed + approved against it
};

export type Decision = "Approve" | "Review" | "Reject";

export type StageStatus = "pass" | "warn" | "fail" | "skip";

export type StageResult = {
  key: StageKey;
  label: string;
  status: StageStatus;
  summary: string;
  tags: string[];
};

export type StageKey = "read" | "vendor" | "duplicate" | "tax" | "po" | "match" | "pattern" | "decision";

export type Run = {
  id: string;
  created_at: string;
  file_name: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  po_number: string | null;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  decision: Decision;
  priority: "high" | "normal";
  tags: string[];
  reason: string;
  variance: number | null;
  within_tolerance: boolean;
  stages: StageResult[];
  extracted: Extracted | null;
  seeded: boolean;
};

export type CheckOutcome = {
  stages: StageResult[];
  decision: Decision;
  priority: "high" | "normal";
  tags: string[];
  reason: string;
  vendor: Vendor | null;
  po: PurchaseOrder | null; // the PO this invoice is billed against (if any)
  variance: number | null; // invoice subtotal minus what was left on the PO (positive = billed extra)
  withinTolerance: boolean;
  poCharge: number; // amount to add to the PO's "already invoiced" if approved
};
