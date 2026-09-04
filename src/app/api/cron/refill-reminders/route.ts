import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";
import { env } from "@/lib/env";
import { runRefillReminders } from "@/lib/refillReminders";
import { readSession } from "@/lib/auth";

export const maxDuration = 300;

function secretOk(provided: string | null): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(env.CRON_SECRET);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function handle(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  const query = req.nextUrl.searchParams.get("secret");
  if (!secretOk(bearer) && !secretOk(query)) {
    const session = await readSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runRefillReminders();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
