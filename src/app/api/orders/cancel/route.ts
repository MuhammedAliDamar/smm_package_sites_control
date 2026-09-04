import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendSlack } from "@/lib/slack";
import { env } from "@/lib/env";

// Sipariş iptal bildirimi: her sipariş için tetiklenebilir. Refill'den FARKLI
// mesaj, aynı Slack kanalına gider. Aktif refill varsa hatırlatmaları da durdurur.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const order = await prisma.order.findUnique({
    where: { id },
    select: { id: true, refillRequestedAt: true },
  });
  if (!order) return NextResponse.json({ error: "order not found" }, { status: 404 });

  // Aktif refill takibi varsa iptal işaretle (5 saatlik hatırlatmalar dursun).
  if (order.refillRequestedAt) {
    await prisma.order.update({ where: { id }, data: { refillCanceledAt: new Date() } });
  }

  const slackOk = await sendSlack(
    `${env.SLACK_MENTION}\n❌ Sipariş İptal talebi\nORDER ID: ${id}`,
  );

  return NextResponse.json({ ok: true, id, slackSent: slackOk });
}
