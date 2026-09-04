import { NextRequest, NextResponse } from "next/server";
import { readVanakServiceDrops } from "@/lib/vanakDrops";
import { assertVanakAccess } from "@/lib/vanakGuard";

// Service Drop Rate sekmesi — okuma. Cron/buton ile önceden hesaplanmış
// periodsData'yı thor DB'sinden döndürür (scrape/hesaplama YOK).
export async function GET(req: NextRequest) {
  const deny = assertVanakAccess(req);
  if (deny) return deny;

  try {
    const data = await readVanakServiceDrops();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

export function OPTIONS(req: NextRequest) {
  return assertVanakAccess(req) ?? new NextResponse(null, { status: 204 });
}
