// Restores the demo vendors, POs and history — run this before every demo.
import { resetDemo } from "@/lib/db";

export async function POST() {
  try {
    await resetDemo();
    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
