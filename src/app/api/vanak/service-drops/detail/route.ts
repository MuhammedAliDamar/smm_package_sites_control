import { NextRequest, NextResponse } from "next/server";
import { assertVanakAccess } from "@/lib/vanakGuard";
import { readPeriodOrders, PERIODS } from "@/lib/vanakDrops";

// Bir servis + periyot için işleme alınan siparişleri + drop oranlarını döndürür (modal).
export async function GET(req: NextRequest) {
  const deny = assertVanakAccess(req);
  if (deny) return deny;

  const serviceId = Number(req.nextUrl.searchParams.get("serviceId"));
  const days = Number(req.nextUrl.searchParams.get("days"));
  if (!Number.isInteger(serviceId) || !PERIODS.includes(days as (typeof PERIODS)[number])) {
    return NextResponse.json({ error: "serviceId and valid days required" }, { status: 400 });
  }
  try {
    const data = await readPeriodOrders(serviceId, days);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

export function OPTIONS(req: NextRequest) {
  return assertVanakAccess(req) ?? new NextResponse(null, { status: 204 });
}
