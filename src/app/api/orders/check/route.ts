import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkOrder } from "@/lib/checker";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const ids: number[] = body.ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids required" }, { status: 400 });
  }
  if (ids.length > 50) {
    return NextResponse.json({ error: "max 50 orders per request" }, { status: 400 });
  }

  const orders = await prisma.order.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      link: true,
      quantity: true,
      startCount: true,
      serviceName: true,
      serviceType: true,
    },
  });

  const results = [];
  for (const order of orders) {
    const result = await checkOrder(order);
    if (result.currentCount !== null) {
      await prisma.order.update({
        where: { id: order.id },
        data: {
          currentCount: result.currentCount,
          dropRate: result.dropRate,
          dropCheckedAt: new Date(),
        },
      });
    }
    results.push(result);
  }

  return NextResponse.json({ results });
}
