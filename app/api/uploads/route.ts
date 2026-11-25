import { listUploads } from "@/lib/db";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json({ uploads: await listUploads() });
  } catch (e: any) {
    return Response.json({ uploads: [], error: e.message });
  }
}
