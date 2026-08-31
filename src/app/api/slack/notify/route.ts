import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { tgSendMessage } from "@/lib/telegram";

export const maxDuration = 60;

const KEY = "botNotify";

// POST { token, chats: [{id,name}], message } -> seçili chat'lere Telegram mesajı gönderir.
// token + chat listesini config'e kaydeder.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const chats: { id: string; name: string }[] = Array.isArray(body.chats)
    ? body.chats.filter(
        (c: unknown): c is { id: string; name: string } =>
          !!c && typeof (c as { id?: unknown }).id === "string",
      )
    : [];

  if (!token) return NextResponse.json({ error: "bot token required" }, { status: 400 });
  if (!message) return NextResponse.json({ error: "message required" }, { status: 400 });
  if (chats.length === 0)
    return NextResponse.json({ error: "select at least one chat" }, { status: 400 });

  // Bilinen chat'leri koru + bu seçimi ekle, token'la beraber kaydet
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  const map = new Map<string, { id: string; name: string }>();
  if (row) {
    try {
      const parsed = JSON.parse(row.value) as { chats?: { id: string; name: string }[] };
      for (const c of parsed.chats ?? []) map.set(c.id, c);
    } catch {
      /* ignore */
    }
  }
  for (const c of chats) map.set(c.id, { id: c.id, name: c.name || c.id });
  await prisma.setting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: JSON.stringify({ token, chats: [...map.values()] }) },
    update: { value: JSON.stringify({ token, chats: [...map.values()] }) },
  });

  const results = await Promise.all(
    chats.map(async (c) => {
      const r = await tgSendMessage(token, c.id, message);
      return { chat: c.name || c.id, ok: r.ok, error: r.error };
    }),
  );
  const sent = results.filter((r) => r.ok).length;
  return NextResponse.json({ ok: true, sent, total: chats.length, results });
}
