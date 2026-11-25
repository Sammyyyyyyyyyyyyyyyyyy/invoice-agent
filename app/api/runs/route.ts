import { listRuns } from "@/lib/db";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json({ runs: await listRuns() });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
