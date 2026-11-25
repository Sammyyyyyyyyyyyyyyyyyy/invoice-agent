// Returns a short-lived link to an uploaded invoice file.
import { fileUrl } from "@/lib/db";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Missing id" }, { status: 400 });
  try {
    const url = await fileUrl(id);
    return url ? Response.redirect(url, 302) : Response.json({ error: "File not found" }, { status: 404 });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
