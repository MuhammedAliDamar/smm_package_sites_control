import { prisma } from "./db";
import { sendSlack } from "./slack";
import { env } from "./env";

const REMINDER_MS = 5 * 60 * 60 * 1000; // 5 saat

/**
 * Aktif refill talepleri için 5 saatte bir Slack hatırlatması yollar.
 * Aktif = refillRequestedAt var, iptal edilmemiş (refillCanceledAt null) ve
 * henüz "Refilled" işaretlenmemiş (refillNoIncrease !== false).
 * Referans zaman: son hatırlatma (yoksa talep zamanı). 5 saat geçtiyse mesaj gider
 * ve refillLastReminderAt güncellenir.
 */
export async function runRefillReminders() {
  const now = Date.now();
  const cutoff = new Date(now - REMINDER_MS);

  const orders = await prisma.order.findMany({
    where: {
      refillRequestedAt: { not: null },
      refillCanceledAt: null,
      // "Refilled" işaretlenmemiş olanlar (null veya true)
      NOT: { refillNoIncrease: false },
      OR: [
        { refillLastReminderAt: null, refillRequestedAt: { lte: cutoff } },
        { refillLastReminderAt: { lte: cutoff } },
      ],
    },
    select: { id: true },
    take: 200,
  });

  if (orders.length === 0) return { sent: 0 };

  let sent = 0;
  for (const o of orders) {
    const ok = await sendSlack(
      `${env.SLACK_MENTION}\n⏰ Refill hatırlatması — hâlâ yapılmadı\nORDER ID: ${o.id}`,
    );
    if (ok) sent++;
    await prisma.order.update({
      where: { id: o.id },
      data: { refillLastReminderAt: new Date() },
    });
  }

  return { sent };
}
