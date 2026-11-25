// Returns a short-lived link to an uploaded invoice file.
import { fileUrl } from "@/lib/db";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const path = new URL(req.url).searchParams.get("path");
  if (!path || !path.startsWith("uploads/")) return Response.json({ error: "Missing file" }, { status: 400 });
  try {
    const url = await fileUrl(path);
    return url ? Response.redirect(url, 302) : Response.json({ error: "File not found" }, { status: 404 });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
