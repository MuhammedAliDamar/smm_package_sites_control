import { prisma } from "./db";
import { checkOrder } from "./checker";

export async function runDropCheck() {
  const orders = await prisma.order.findMany({
    where: {
      status: { in: ["completed", "Completed", "complete", "Complete"] },
      link: { not: null },
      quantity: { not: null, gt: 0 },
      startCount: { not: null, gt: 0 },
    },
    select: {
      id: true,
      link: true,
      quantity: true,
      startCount: true,
      serviceName: true,
      serviceType: true,
    },
    orderBy: { dropCheckedAt: { sort: "asc", nulls: "first" } },
    take: 200,
  });

  if (orders.length === 0) return { checked: 0, success: 0, fail: 0 };

  let success = 0;
  let fail = 0;

  for (const order of orders) {
    try {
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
        success++;
      } else {
        await prisma.order.update({
          where: { id: order.id },
          data: { dropCheckedAt: new Date() },
        });
        fail++;
      }
    } catch {
      fail++;
    }
  }

  return { checked: orders.length, success, fail };
}
