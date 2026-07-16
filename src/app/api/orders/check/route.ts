import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkOrder, type CheckResult } from "@/lib/checker";

const BATCH_SIZE = 10;

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

  const results: CheckResult[] = [];

  for (let i = 0; i < orders.length; i += BATCH_SIZE) {
    const batch = orders.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map((order) => checkOrder(order)));

    await Promise.all(
      batchResults.map((result) => {
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

    results.push(...batchResults);
  }

  return NextResponse.json({ results });
}
