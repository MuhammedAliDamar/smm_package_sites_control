import { prisma } from "./db";
import { checkOrder } from "./checker";
import { sendSlack } from "./slack";
import { env } from "./env";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Refill talebi verilmiş siparişleri 24 saat sonra tekrar kontrol eder.
 * - refillRequestedAt üstünden >= 24 saat geçmiş ve henüz kontrol edilmemiş
 *   (refillCheckedAt == null) siparişleri alır.
 * - Güncel current count'u çeker, baseline ile karşılaştırır.
 * - Artış YOKSA (count aynı/düşük ya da ölçülemiyor) ikinci Slack mesajını yollar:
 *   "24 saattir Refill yapılmadı ORDER ID: {id}"
 * - Her sipariş için refillCheckedAt işaretlenir ki tekrar işlenmesin.
 */
export async function runRefillCheck() {
  const cutoff = new Date(Date.now() - DAY_MS);

  const orders = await prisma.order.findMany({
    where: {
      refillRequestedAt: { not: null, lte: cutoff },
      refillCheckedAt: null,
      refillCanceledAt: null,
    },
    select: {
      id: true,
      link: true,
      quantity: true,
      startCount: true,
      serviceName: true,
      serviceType: true,
      refillBaselineCount: true,
    },
    take: 200,
  });

  if (orders.length === 0) return { checked: 0, noIncrease: 0, increased: 0 };

  let noIncrease = 0;
  let increased = 0;

  for (const order of orders) {
    const check = await checkOrder(order);
    const fresh = check.currentCount;
    const baseline = order.refillBaselineCount;

    // Artış sadece iki sayı da bilinip yeni sayı büyükse "kesin" kabul edilir.
    // Ölçülemeyen durumlar refill yapılmamış sayılır → ikinci mesaj gider.
    const hasIncrease = fresh !== null && baseline !== null && fresh > baseline;

    if (hasIncrease) {
      increased++;
    } else {
      noIncrease++;
      await sendSlack(
        `${env.SLACK_MENTION}\n24 saattir Refill yapılmadı\nORDER ID: ${order.id}`,
      );
    }

    await prisma.order.update({
      where: { id: order.id },
      data: {
        refillCheckedAt: new Date(),
        refillNoIncrease: !hasIncrease,
        ...(fresh !== null
          ? {
              currentCount: fresh,
              dropRate: check.dropRate,
              dropCheckedAt: new Date(),
            }
          : {}),
      },
    });
  }

  return { checked: orders.length, noIncrease, increased };
}
