import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";
import { env } from "@/lib/env";
import { readSession } from "@/lib/auth";
import { computeAllServiceDrops, getComputeProgress } from "@/lib/serviceDrops";

export const maxDuration = 300;

function secretOk(provided: string | null): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided); const b = Buffer.from(env.CRON_SECRET);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function handle(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  const query = req.nextUrl.searchParams.get("secret");
  if (!secretOk(bearer) && !secretOk(query)) {
    const s = await readSession();
    if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const progress = await getComputeProgress();
  if (progress.running) return NextResponse.json({ ok: true, running: true, ...progress });
  void computeAllServiceDrops().catch(() => {});
  return NextResponse.json({ ok: true, started: true });
}

export const GET = handle;
export const POST = handle;
