import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkOrder, type CheckResult } from "@/lib/checker";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const ids: number[] = body.ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids required" }, { status: 400 });
  }
  if (ids.length > 10) {
    return NextResponse.json({ error: "max 10 orders per request" }, { status: 400 });
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

  const results: CheckResult[] = await Promise.all(
    orders.map((order) => checkOrder(order)),
  );

  await Promise.all(
    results.map((result) => {
      if (result.currentCount !== null) {
        return prisma.order.update({
          where: { id: result.orderId },
          data: {
            currentCount: result.currentCount,
            dropRate: result.dropRate,
            dropCheckedAt: new Date(),
          },
        });
      }
    }),
  );

  return NextResponse.json({ results });
}
