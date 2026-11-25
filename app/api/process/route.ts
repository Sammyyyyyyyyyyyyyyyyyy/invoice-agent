// POST an invoice file → streams each stage as it happens (one JSON object per line).
import { addToPo, loadContext, saveRun } from "@/lib/db";
import { extractInvoice } from "@/lib/extract";
import { evaluate, STAGE_LABELS } from "@/lib/rules";

export const runtime = "nodejs";
export const maxDuration = 60;

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "No file uploaded" }, { status: 400 });
  const buf = Buffer.from(await file.arrayBuffer());
  const mime = file.type || "application/pdf";

  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(new TextEncoder().encode(JSON.stringify(o) + "\n"));
      try {
        // 1. AI reads the invoice
        send({ type: "running", key: "read", label: STAGE_LABELS.read });
        const t0 = Date.now();
        const [extracted, ctx] = await Promise.all([extractInvoice(buf, mime, (message) => send({ type: "note", message })), loadContext()]);
        send({ type: "extracted", extracted, model: extracted.model, ms: Date.now() - t0 });

        // 2–8. Rules decide (instant), streamed one by one so the reviewer can follow along
        const out = evaluate(extracted, ctx);
        for (const s of out.stages) {
          if (s.key !== "read") {
            send({ type: "running", key: s.key, label: s.label });
            await pause(350);
          }
          send({ type: "stage", stage: s });
        }

        const run = await saveRun({
          file_name: file.name,
          vendor_id: out.vendor?.id ?? null,
          vendor_name: out.vendor?.name ?? extracted.vendor_name,
          invoice_number: extracted.invoice_number,
          invoice_date: extracted.invoice_date,
          po_number: out.po?.id ?? extracted.po_number,
          subtotal: extracted.subtotal,
          tax: extracted.tax,
          total: extracted.total,
          decision: out.decision,
          priority: out.priority,
          tags: out.tags,
          reason: out.reason,
          variance: out.variance,
          within_tolerance: out.withinTolerance,
          stages: out.stages,
          extracted,
          seeded: false,
        });
        // Only approved invoices use up the PO's balance.
        if (out.decision === "Approve" && out.po && out.poCharge > 0) await addToPo(out.po.id, out.poCharge);

        send({ type: "done", run });
      } catch (e: any) {
        send({ type: "error", message: e?.message ?? String(e) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
