// Display names for invoices (rename). Key = test file name or upload path.
import { getNames, setName } from "@/lib/db";
export const dynamic = "force-dynamic";

export async function GET() {
  try { return Response.json({ names: await getNames() }); }
  catch (e: any) { return Response.json({ names: {}, error: e.message }); }
}

export async function PUT(req: Request) {
  const { key, name } = await req.json();
  if (!key || typeof name !== "string" || !name.trim()) return Response.json({ error: "Name required" }, { status: 400 });
  try { return Response.json({ names: await setName(String(key), name.trim().slice(0, 120)) }); }
  catch (e: any) { return Response.json({ error: e.message }, { status: 500 }); }
}
