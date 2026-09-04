import { NextRequest, NextResponse } from "next/server";
import { readPeriodOrders, PERIODS } from "@/lib/serviceDrops";

export async function GET(req: NextRequest) {
  const serviceId = Number(req.nextUrl.searchParams.get("serviceId"));
  const days = Number(req.nextUrl.searchParams.get("days"));
  if (!Number.isInteger(serviceId) || !PERIODS.includes(days as (typeof PERIODS)[number])) {
    return NextResponse.json({ error: "serviceId and valid days required" }, { status: 400 });
  }
  try {
    return NextResponse.json(await readPeriodOrders(serviceId, days));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
