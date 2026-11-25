// The only place AI is used: reading the invoice (clean PDF or scanned image) into structured fields.
import { GoogleGenAI, Type } from "@google/genai";
import type { Extracted } from "./types";

const num = { type: Type.NUMBER, nullable: true };
const str = { type: Type.STRING, nullable: true };

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    vendor_name: { ...str, description: "Company that issued the invoice (the seller), not the buyer" },
    vendor_gstin: { ...str, description: "Seller's GSTIN / GST number" },
    invoice_number: str,
    invoice_date: { ...str, description: "As printed on the invoice" },
    po_number: { ...str, description: "Purchase order reference ONLY if explicitly printed. Never guess." },
    line_items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { description: { type: Type.STRING }, quantity: num, unit_price: num, amount: num },
        required: ["description"],
      },
    },
    subtotal: { ...num, description: "Amount before tax" },
    tax: { ...num, description: "Total tax amount (sum of IGST/CGST/SGST etc.)" },
    total: { ...num, description: "Final amount payable including tax" },
    bank_account: { ...str, description: "Bank account number the seller asks to be paid into" },
    bank_ifsc: str,
    is_scanned: { type: Type.BOOLEAN, description: "true if the document is a scanned/photographed image rather than a digital PDF" },
    notes: { ...str, description: "Anything unusual a finance reviewer should know (e.g. 'bank details have changed' notices). Null if nothing." },
  },
  required: ["vendor_name", "invoice_number", "line_items", "subtotal", "tax", "total", "is_scanned"],
};

const PROMPT = `You are an accounts-payable assistant. Read this vendor invoice and extract the fields exactly as printed.
Rules:
- Numbers must be plain numbers in rupees (e.g. "Rs. 5,00,300.00" -> 500300). No currency symbols or commas.
- If a field is not on the invoice, return null. Do NOT invent or infer values — especially the PO number.
- The buyer is "Acme Retail Pvt Ltd"; vendor_name is the OTHER company (the one asking to be paid).`;

export async function extractInvoice(file: Buffer, mimeType: string): Promise<Extracted> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  const ai = new GoogleGenAI({ apiKey });
  const res = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ inlineData: { mimeType, data: file.toString("base64") } }, { text: PROMPT }] }],
    config: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0 },
  });
  const raw = JSON.parse(res.text ?? "{}");
  return {
    vendor_name: raw.vendor_name ?? null,
    vendor_gstin: raw.vendor_gstin ?? null,
    invoice_number: raw.invoice_number ?? null,
    invoice_date: raw.invoice_date ?? null,
    po_number: raw.po_number ?? null,
    line_items: (raw.line_items ?? []).map((l: any) => ({
      description: l.description ?? "",
      quantity: l.quantity ?? null,
      unit_price: l.unit_price ?? null,
      amount: l.amount ?? (l.quantity != null && l.unit_price != null ? l.quantity * l.unit_price : null),
    })),
    subtotal: raw.subtotal ?? null,
    tax: raw.tax ?? null,
    total: raw.total ?? null,
    bank_account: raw.bank_account ?? null,
    bank_ifsc: raw.bank_ifsc ?? null,
    is_scanned: !!raw.is_scanned,
    notes: raw.notes ?? null,
  };
}
