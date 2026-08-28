import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkOrder } from "@/lib/checker";
import { sendSlack } from "@/lib/slack";
import { env } from "@/lib/env";

export const maxDuration = 300;

/**
 * Refill talebi: completed bir sipariş için tetiklenir.
 * - Siparişin o anki current count'u alınır (baseline olarak saklanır)
 * - refillRequestedAt işaretlenir (24 saatlik takip buradan başlar)
 * - Slack'e "Refill Talebi oluşturuldu" mesajı gönderilir
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const order = await prisma.order.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      link: true,
      quantity: true,
      startCount: true,
      serviceName: true,
      serviceType: true,
      refillRequestedAt: true,
    },
  });
  if (!order) {
    return NextResponse.json({ error: "order not found" }, { status: 404 });
  }
  if (order.refillRequestedAt) {
    return NextResponse.json(
      { error: "already requested", refillRequestedAt: order.refillRequestedAt },
      { status: 409 },
    );
  }

  // O anki current count'u yakala (baseline). Alınamazsa null olarak kaydedilir;
  // 24 saatlik kontrol yine de artış olup olmadığını değerlendirir.
  const check = await checkOrder(order);
  const baseline = check.currentCount;

  await prisma.order.update({
    where: { id },
    data: {
      refillRequestedAt: new Date(),
      refillBaselineCount: baseline,
      refillCheckedAt: null,
      refillNoIncrease: null,
      ...(baseline !== null
        ? {
            currentCount: baseline,
            dropRate: check.dropRate,
            dropCheckedAt: new Date(),
          }
        : {}),
    },
  });

  const slackOk = await sendSlack(
    `${env.SLACK_MENTION}\nRefill Talebi oluşturuldu.\nORDER ID: ${id}`,
  );

  return NextResponse.json({
    ok: true,
    id,
    baselineCount: baseline,
    slackSent: slackOk,
  });
}

// PATCH { id }              -> "refilled" işaretle (No increase -> Refilled)
// PATCH { id, untrack: true } -> refill takibini tamamen kaldır (alanları temizle)
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  const order = await prisma.order.findUnique({ where: { id }, select: { id: true } });
  if (!order) {
    return NextResponse.json({ error: "order not found" }, { status: 404 });
  }
  if (body.untrack === true) {
    await prisma.order.update({
      where: { id },
      data: {
        refillRequestedAt: null,
        refillBaselineCount: null,
        refillCheckedAt: null,
        refillNoIncrease: null,
      },
    });
    return NextResponse.json({ ok: true, id, untracked: true });
  }
  await prisma.order.update({
    where: { id },
    data: { refillNoIncrease: false, refillCheckedAt: new Date() },
  });
  return NextResponse.json({ ok: true, id });
}
