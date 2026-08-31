import { prisma } from "./db";
import { fetchUpdateRows } from "./thorUpdates";
import { tgSendMessage } from "./telegram";

const STATE_KEY = "thorUpdatesSent";
const BOT_KEY = "botNotify";
const MAX_KEYS = 8000; // sent-set üst sınırı
const MAX_SEND_PER_RUN = 40; // bir turda gönderilecek yeni satır tavanı

type SentState = { seeded: boolean; keys: string[] };

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function readState(): Promise<SentState> {
  const row = await prisma.setting.findUnique({ where: { key: STATE_KEY } });
  if (!row) return { seeded: false, keys: [] };
  try {
    const p = JSON.parse(row.value) as Partial<SentState>;
    return { seeded: !!p.seeded, keys: p.keys ?? [] };
  } catch {
    return { seeded: false, keys: [] };
  }
}

async function writeState(seeded: boolean, keys: string[]) {
  // sırayı koru, son MAX_KEYS'i tut
  const trimmed = keys.slice(-MAX_KEYS);
  const value = JSON.stringify({ seeded, keys: trimmed });
  await prisma.setting.upsert({
    where: { key: STATE_KEY },
    create: { key: STATE_KEY, value },
    update: { value },
  });
}

async function readBotConfig(): Promise<{ token: string; chats: { id: string; name: string }[] }> {
  const row = await prisma.setting.findUnique({ where: { key: BOT_KEY } });
  if (!row) return { token: "", chats: [] };
  try {
    const p = JSON.parse(row.value) as { token?: string; chats?: { id: string; name: string }[] };
    return { token: p.token ?? "", chats: p.chats ?? [] };
  } catch {
    return { token: "", chats: [] };
  }
}

/**
 * /updates'i çeker; daha önce gönderilmemiş satırları Telegram bot ile bildirir.
 * İlk çalıştırmada mevcut satırlar baseline olarak işaretlenir (bildirim gönderilmez).
 */
export async function runUpdatesCheck(): Promise<{
  ok: boolean;
  seeded?: boolean;
  total?: number;
  new?: number;
  sent?: number;
  error?: string;
}> {
  const allRows = await fetchUpdateRows();
  if (!allRows) return { ok: false, error: "login or fetch failed" };

  // Sadece bugünün tarihli VE rate değişikliği (increased/decreased) satırları
  const today = todayStr();
  const rows = allRows.filter(
    (r) => r.date === today && /^rate\s+(increased|decreased)/i.test(r.update),
  );

  const state = await readState();
  const sentSet = new Set(state.keys);
  const currentKeys = rows.map((r) => r.key);

  // İlk çalıştırma: baseline — mevcutları görüldü işaretle, bildirim yok
  if (!state.seeded) {
    const merged = [...state.keys];
    for (const k of currentKeys) if (!sentSet.has(k)) { merged.push(k); sentSet.add(k); }
    await writeState(true, merged);
    return { ok: true, seeded: true, total: rows.length, new: 0, sent: 0 };
  }

  const newRows = rows.filter((r) => !sentSet.has(r.key));
  if (newRows.length === 0) return { ok: true, total: rows.length, new: 0, sent: 0 };

  const cfg = await readBotConfig();
  // Telegram yapılandırılmamışsa satırları "gönderildi" saymayız — sonra gönderilsin
  if (!cfg.token || cfg.chats.length === 0) {
    return { ok: true, total: rows.length, new: newRows.length, sent: 0, error: "telegram not configured" };
  }

  // Tabloda yeniler genelde üstte — eskiden yeniye sırayla gönder
  const toSend = newRows.reverse().slice(0, MAX_SEND_PER_RUN);
  let sent = 0;
  const newlySeen = [...state.keys];
  for (const row of toSend) {
    const text = `🔔 Service Update\n${row.service}\n${row.date}\n${row.update}`;
    for (const ch of cfg.chats) {
      const r = await tgSendMessage(cfg.token, ch.id, text);
      if (r.ok) sent++;
    }
    newlySeen.push(row.key);
  }
  await writeState(true, newlySeen);

  return { ok: true, total: rows.length, new: newRows.length, sent };
}
