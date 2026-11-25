// Vendor list + POs + current rule settings, for the "Reference data" panel.
import { RULES } from "@/lib/config";
import { loadContext } from "@/lib/db";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { vendors, pos } = await loadContext();
    return Response.json({ vendors, pos, rules: RULES });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
