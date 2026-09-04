import { NextRequest, NextResponse } from "next/server";
import { assertVanakAccess } from "@/lib/vanakGuard";
import { computeOneService, computeOnePeriod, PERIODS } from "@/lib/vanakDrops";

export const maxDuration = 300;

// serviceId + (opsiyonel) days → days verilirse SADECE o periyodu, yoksa servisin
// tüm periyotlarını yeniden hesaplar. Senkron; bitince güncel veriyi döner.
export async function POST(req: NextRequest) {
  const deny = assertVanakAccess(req);
  if (deny) return deny;

  const body = await req.json().catch(() => ({}));
  const serviceId = Number(body.serviceId);
  if (!Number.isInteger(serviceId)) {
    return NextResponse.json({ error: "serviceId required" }, { status: 400 });
  }
  const hasDays = body.days !== undefined && body.days !== null;
  const days = Number(body.days);
  if (hasDays && !PERIODS.includes(days as (typeof PERIODS)[number])) {
    return NextResponse.json({ error: "invalid days" }, { status: 400 });
  }
  try {
    const result = hasDays ? await computeOnePeriod(serviceId, days) : await computeOneService(serviceId);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

export function OPTIONS(req: NextRequest) {
  return assertVanakAccess(req) ?? new NextResponse(null, { status: 204 });
}
