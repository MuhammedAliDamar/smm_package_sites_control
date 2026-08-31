// Telegram Bot API yardımcıları.
// NOT: Telegram'da "botun üye olduğu tüm chat'leri" listeleyen bir API yoktur.
// Chat'ler yalnızca getUpdates ile keşfedilir (bot bir gruba eklendiğinde /
// mesaj aldığında). Bu yüzden UI'da elle chat ID ekleme de sunulur.

const API = "https://api.telegram.org/bot";

export type TgChat = { id: string; name: string; type: string };

export async function tgGetMe(
  token: string,
): Promise<{ ok: boolean; username?: string; error?: string }> {
  if (!token) return { ok: false, error: "no token" };
  try {
    const res = await fetch(`${API}${token}/getMe`, { signal: AbortSignal.timeout(15_000) });
    const json = (await res.json()) as { ok: boolean; result?: { username?: string }; description?: string };
    if (!json.ok) return { ok: false, error: json.description ?? "invalid token" };
    return { ok: true, username: json.result?.username };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch error" };
  }
}

function chatName(chat: {
  id: number;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}): string {
  if (chat.title) return chat.title;
  if (chat.username) return `@${chat.username}`;
  const full = [chat.first_name, chat.last_name].filter(Boolean).join(" ");
  return full || String(chat.id);
}

/** getUpdates ile botun son gördüğü chat'leri (grup/kanal/özel) keşfeder. */
export async function tgDiscoverChats(
  token: string,
): Promise<{ ok: boolean; chats: TgChat[]; error?: string }> {
  if (!token) return { ok: false, chats: [], error: "no token" };
  try {
    const res = await fetch(`${API}${token}/getUpdates?limit=100&timeout=0`, {
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json()) as {
      ok: boolean;
      description?: string;
      result?: Array<Record<string, { chat?: Parameters<typeof chatName>[0] & { type: string } }>>;
    };
    if (!json.ok) return { ok: false, chats: [], error: json.description ?? "getUpdates failed" };

    const map = new Map<string, TgChat>();
    for (const upd of json.result ?? []) {
      for (const key of ["message", "edited_message", "channel_post", "my_chat_member", "chat_member"]) {
        const chat = (upd as Record<string, { chat?: Parameters<typeof chatName>[0] & { type: string } }>)[key]?.chat;
        if (chat && chat.id != null) {
          const id = String(chat.id);
          if (!map.has(id)) map.set(id, { id, name: chatName(chat), type: chat.type });
        }
      }
    }
    return { ok: true, chats: [...map.values()] };
  } catch (e) {
    return { ok: false, chats: [], error: e instanceof Error ? e.message : "fetch error" };
  }
}

/** Belirtilen chat'e mesaj gönderir. */
export async function tgSendMessage(
  token: string,
  chatId: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${API}${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json()) as { ok: boolean; description?: string };
    return { ok: json.ok, error: json.description };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch error" };
  }
}
