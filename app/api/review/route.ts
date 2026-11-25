// A person resolves an on-hold invoice: approve or reject, with a required note.
import { reviewRun } from "@/lib/db";

export async function POST(req: Request) {
  const { id, action, note, by } = await req.json();
  if (!id || !["Approve", "Reject"].includes(action)) return Response.json({ error: "Invalid request" }, { status: 400 });
  if (!note || !String(note).trim()) return Response.json({ error: "Add a note explaining the decision." }, { status: 400 });
  try {
    const run = await reviewRun(id, action, String(note).trim().slice(0, 500), String(by || "AP reviewer").trim().slice(0, 60));
    return Response.json({ run });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 400 });
  }
}
