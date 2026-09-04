import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { assertVanakAccess } from "@/lib/vanakGuard";
import { clientIp } from "@/lib/rateLimit";

// Sessiz oturum heartbeat. Vanak client periyodik çağırır (kullanıcı fark etmez).
// - beat: oturumu upsert eder, lastSeenAt + hits + durationMs günceller.
// - end (sayfa kapanışı / sendBeacon): endedAt + kesin süre yazar.
export async function POST(req: NextRequest) {
  const deny = assertVanakAccess(req);
  if (deny) return deny;

  const b = await req.json().catch(() => ({}));
  const sessionId = typeof b.sessionId === "string" ? b.sessionId.slice(0, 80) : "";
  if (!sessionId) return NextResponse.json({ ok: false }, { status: 200 });

  const s = (v: unknown, n = 300) => (typeof v === "string" ? v.slice(0, n) : null);

  try {
    if (b.end) {
      // Oturumu kapat: kesin süre
      const row = await prisma.panelSession.findUnique({ where: { sessionId } });
      if (row) {
        await prisma.panelSession.update({
          where: { sessionId },
          data: { endedAt: new Date(), durationMs: Date.now() - row.startedAt.getTime() },
        });
      }
      return NextResponse.json({ ok: true });
    }

    const existing = await prisma.panelSession.findUnique({ where: { sessionId } });
    if (existing) {
      await prisma.panelSession.update({
        where: { sessionId },
        data: {
          lastSeenAt: new Date(),
          durationMs: Date.now() - existing.startedAt.getTime(),
          hits: { increment: 1 },
          path: s(b.path, 200) ?? existing.path,
          ipAddress: clientIp(req),
        },
      });
    } else {
      await prisma.panelSession.create({
        data: {
          sessionId,
          clientId: s(b.clientId, 80) ?? "unknown",
          panel: "vanak",
          fingerprint: s(b.fingerprint, 128),
          ipAddress: clientIp(req),
          userAgent: (req.headers.get("user-agent") || "").slice(0, 300) || null,
          language: s(b.language, 40),
          timezone: s(b.timezone, 60),
          screen: s(b.screen, 40),
          platform: s(b.platform, 60),
          path: s(b.path, 200),
          referrer: s(b.referrer, 300),
        },
      });
    }
  } catch {
    /* sessiz kal */
  }
  return NextResponse.json({ ok: true });
}
