import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Telegram bot bildirim ayarı (token + bilinen chat listesi). Path "slack" tarihsel.
const KEY = "botNotify";

type BotConfig = {
  token: string;
  chats: { id: string; name: string }[];
};

async function readConfig(): Promise<BotConfig> {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  if (!row) return { token: "", chats: [] };
  try {
    const parsed = JSON.parse(row.value) as Partial<BotConfig>;
    return { token: parsed.token ?? "", chats: parsed.chats ?? [] };
  } catch {
    return { token: "", chats: [] };
  }
}

export async function GET() {
  return NextResponse.json(await readConfig());
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const chats = Array.isArray(body.chats)
    ? body.chats
        .filter((c: unknown): c is { id: string; name: string } =>
          !!c && typeof (c as { id?: unknown }).id === "string",
        )
        .map((c: { id: string; name?: string }) => ({ id: c.id, name: c.name ?? c.id }))
    : [];
  const value = JSON.stringify({ token, chats });
  await prisma.setting.upsert({
    where: { key: KEY },
    create: { key: KEY, value },
    update: { value },
  });
  return NextResponse.json({ ok: true });
}
