import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { tgGetMe, tgDiscoverChats } from "@/lib/telegram";

const KEY = "botNotify";

// POST { token } -> token doğrula (getMe) + getUpdates ile chat'leri keşfet.
// Bilinen (kayıtlı) chat'lerle birleştirir, token'ı kaydeder (tekrar girme derdi olmasın).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  let token = typeof body.token === "string" ? body.token.trim() : "";

  // Kayıtlı config'i oku (token yoksa oradan al, chat merge için kullan)
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  let savedChats: { id: string; name: string }[] = [];
  if (row) {
    try {
      const parsed = JSON.parse(row.value) as { token?: string; chats?: { id: string; name: string }[] };
      if (!token) token = parsed.token ?? "";
      savedChats = parsed.chats ?? [];
    } catch {
      /* ignore */
    }
  }
  if (!token) return NextResponse.json({ error: "bot token required" }, { status: 400 });

  const me = await tgGetMe(token);
  if (!me.ok) return NextResponse.json({ error: me.error ?? "invalid token" }, { status: 400 });

  const disc = await tgDiscoverChats(token);
  if (!disc.ok) return NextResponse.json({ error: disc.error ?? "discover failed" }, { status: 400 });

  // Keşfedilen + kayıtlı chat'leri id'ye göre birleştir
  const map = new Map<string, { id: string; name: string }>();
  for (const c of savedChats) map.set(c.id, { id: c.id, name: c.name });
  for (const c of disc.chats) map.set(c.id, { id: c.id, name: c.name });
  const chats = [...map.values()];

  // Token'ı (ve birleşik chat listesini) kaydet
  await prisma.setting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: JSON.stringify({ token, chats }) },
    update: { value: JSON.stringify({ token, chats }) },
  });

  return NextResponse.json({ bot: me.username, chats });
}
