// Storage (Supabase / Postgres). Server-side only — uses the service role key.
import { createClient } from "@supabase/supabase-js";
import { SEED_POS, SEED_RUNS, SEED_VENDORS } from "./seed";
import type { PurchaseOrder, Run, Vendor } from "./types";

function client() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set");
  return createClient(url, key, { auth: { persistSession: false } });
}

const must = <T,>(r: { data: T | null; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
};

export async function loadContext(): Promise<{ vendors: Vendor[]; pos: PurchaseOrder[]; runs: Run[] }> {
  const db = client();
  const [v, p, r] = await Promise.all([
    db.from("vendors").select("*").order("id"),
    db.from("purchase_orders").select("*").order("id"),
    db.from("runs").select("*").order("created_at", { ascending: false }).limit(500),
  ]);
  return {
    vendors: must(v) as Vendor[],
    pos: (must(p) as any[]).map((x) => ({ ...x, amount: Number(x.amount), invoiced: Number(x.invoiced) })),
    runs: (must(r) as any[]).map(numRun),
  };
}

const numRun = (x: any): Run => ({
  ...x,
  subtotal: x.subtotal === null ? null : Number(x.subtotal),
  tax: x.tax === null ? null : Number(x.tax),
  total: x.total === null ? null : Number(x.total),
  variance: x.variance === null ? null : Number(x.variance),
});

export async function listRuns(): Promise<Run[]> {
  return (must(await client().from("runs").select("*").order("created_at", { ascending: false }).limit(500)) as any[]).map(numRun);
}

export async function saveRun(run: Omit<Run, "id" | "created_at">): Promise<Run> {
  return numRun(must(await client().from("runs").insert(run).select().single()));
}

export async function addToPo(poId: string, amount: number) {
  const db = client();
  const po = must(await db.from("purchase_orders").select("invoiced").eq("id", poId).single()) as { invoiced: number };
  must(await db.from("purchase_orders").update({ invoiced: Number(po.invoiced) + amount }).eq("id", poId).select());
}

export async function resetDemo() {
  const db = client();
  await clearFiles().catch(() => {});
  must(await db.from("runs").delete().not("id", "is", null).select("id"));
  must(await db.from("purchase_orders").delete().not("id", "is", null).select("id"));
  must(await db.from("vendors").delete().not("id", "is", null).select("id"));
  must(await db.from("vendors").insert(SEED_VENDORS).select("id"));
  must(await db.from("purchase_orders").insert(SEED_POS).select("id"));
  must(await db.from("runs").insert(SEED_RUNS).select("id"));
}

// ---- Uploaded invoice files (Supabase Storage, private bucket) ----
const BUCKET = "invoices";

async function ensureBucket() {
  const db = client();
  const { data } = await db.storage.getBucket(BUCKET);
  if (!data) await db.storage.createBucket(BUCKET, { public: false });
}

export async function saveFile(path: string, buf: Buffer, contentType: string) {
  await ensureBucket();
  const { error } = await client().storage.from(BUCKET).upload(path, buf, { contentType, upsert: true });
  if (error) throw new Error(error.message);
}

export async function fileUrl(path: string): Promise<string | null> {
  const { data } = await client().storage.from(BUCKET).createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}

/** Uploaded files, newest first. Path format: uploads/<timestamp>__<name> */
export async function listUploads(limit = 8) {
  await ensureBucket();
  const { data } = await client().storage.from(BUCKET).list("uploads", { limit: 100, sortBy: { column: "name", order: "desc" } });
  return (data ?? [])
    .filter((f) => f.name.includes("__"))
    .slice(0, limit)
    .map((f) => {
      const [ts, ...rest] = f.name.split("__");
      return { path: "uploads/" + f.name, name: decodeURIComponent(rest.join("__")), uploaded_at: new Date(Number(ts)).toISOString() };
    });
}

export async function clearFiles() {
  const db = client();
  const { data } = await db.storage.from(BUCKET).list("uploads", { limit: 1000 });
  if (data?.length) await db.storage.from(BUCKET).remove(data.map((f) => "uploads/" + f.name));
}
