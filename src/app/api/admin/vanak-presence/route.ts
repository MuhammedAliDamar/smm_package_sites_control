import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/auth";

// Admin-only: vanak panelinde şu an aktif oturumlar + geçmiş oturum logu.
// Aktif = son 60 sn içinde heartbeat atmış (ve kapanmamış) oturum.
const ACTIVE_WINDOW_MS = 60_000;

export async function GET(req: NextRequest) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const activeSince = new Date(Date.now() - ACTIVE_WINDOW_MS);
  const limit = Math.min(200, Number(req.nextUrl.searchParams.get("limit") ?? 100));

  const [activeRows, recentRows] = await Promise.all([
    prisma.panelSession.findMany({
      where: { panel: "vanak", endedAt: null, lastSeenAt: { gte: activeSince } },
      orderBy: { lastSeenAt: "desc" },
    }),
    prisma.panelSession.findMany({
      where: { panel: "vanak" },
      orderBy: { startedAt: "desc" },
      take: limit,
    }),
  ]);

  const shape = (r: (typeof recentRows)[number]) => ({
    sessionId: r.sessionId,
    clientId: r.clientId,
    fingerprint: r.fingerprint,
    ipAddress: r.ipAddress,
    userAgent: r.userAgent,
    language: r.language,
    timezone: r.timezone,
    screen: r.screen,
    platform: r.platform,
    path: r.path,
    referrer: r.referrer,
    startedAt: r.startedAt.toISOString(),
    lastSeenAt: r.lastSeenAt.toISOString(),
    endedAt: r.endedAt?.toISOString() ?? null,
    durationMs: r.durationMs,
    hits: r.hits,
    live: !r.endedAt && r.lastSeenAt >= activeSince,
  });

  return NextResponse.json({
    activeCount: activeRows.length,
    windowSeconds: ACTIVE_WINDOW_MS / 1000,
    active: activeRows.map(shape),
    recent: recentRows.map(shape),
  });
}
