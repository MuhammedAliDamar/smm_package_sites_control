import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendSlack, postWebhook } from "@/lib/slack";
import { env } from "@/lib/env";

// Bir siparişin notlarını listeler (yeniden eskiye).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const notes = await prisma.orderNote.findMany({
    where: { orderId: id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ notes });
}

// Siparişe yeni bir not ekler (geçmiş notlar korunur).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const data = await req.json().catch(() => ({}));
  const body = typeof data.body === "string" ? data.body.trim() : "";
  if (!body) {
    return NextResponse.json({ error: "note body required" }, { status: 400 });
  }

  const order = await prisma.order.findUnique({ where: { id }, select: { id: true } });
  if (!order) {
    return NextResponse.json({ error: "order not found" }, { status: 404 });
  }

  const note = await prisma.orderNote.create({
    data: { orderId: id, body: body.slice(0, 1000) },
  });
  // Not sayısı/tarihine göre sıralama için son not zamanını denormalize et.
  await prisma.order.update({
    where: { id },
    data: { lastNoteAt: note.createdAt },
  });

  // Checkbox işaretliyse seçili Slack kanalına bildirim gönder. channelId, env'deki
  // SLACK_NOTE_CHANNELS index'i; geçersizse/verilmezse varsayılan webhook.
  let slackSent = false;
  if (data.notify === true) {
    const text = `Not eklendi — ORDER ID: ${id}\n${note.body}`;
    const idx = Number(data.channelId);
    const channel = Number.isInteger(idx) ? env.SLACK_NOTE_CHANNELS[idx] : undefined;
    slackSent = channel ? await postWebhook(channel.url, text) : await sendSlack(text);
  }

  return NextResponse.json({ ok: true, note, slackSent });
}
