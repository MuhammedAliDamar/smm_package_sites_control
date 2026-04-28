import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";
import { env } from "@/lib/env";
import { runSync } from "@/lib/sync";
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

  let triggeredBy = "cron";
  if (!secretOk(bearer) && !secretOk(query)) {
    const session = await readSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    triggeredBy = `manual:${session.email}`;
  }

  try {
    const result = await runSync({ triggeredBy });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}
