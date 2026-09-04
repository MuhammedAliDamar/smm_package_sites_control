import { NextRequest, NextResponse } from "next/server";
import { assertVanakAccess } from "@/lib/vanakGuard";
import { computeAllVanakServiceDrops, getComputeProgress } from "@/lib/vanakDrops";

export const maxDuration = 300;

// POST → hesaplamayı başlat (fire-and-forget, arka planda). Hemen döner.
export async function POST(req: NextRequest) {
  const deny = assertVanakAccess(req);
  if (deny) return deny;

  const progress = await getComputeProgress();
  if (progress.running) {
    return NextResponse.json({ started: false, running: true, ...progress });
  }
  // Arka planda çalıştır; response'u bekletme.
  void computeAllVanakServiceDrops().catch(() => {});
  return NextResponse.json({ started: true, running: true });
}

// GET → ilerleme durumu (UI polling)
export async function GET(req: NextRequest) {
  const deny = assertVanakAccess(req);
  if (deny) return deny;
  const progress = await getComputeProgress();
  return NextResponse.json(progress);
}

export function OPTIONS(req: NextRequest) {
  return assertVanakAccess(req) ?? new NextResponse(null, { status: 204 });
}
