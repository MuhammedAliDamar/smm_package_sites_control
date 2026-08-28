import { env } from "./env";

/**
 * Slack incoming-webhook'una basit metin bildirimi gönderir.
 * Webhook tanımlı değilse sessizce no-op (dev ortamı patlamasın).
 * Bildirim hatası ana akışı bozmamalı; hata fırlatmaz, boolean döner.
 */
export async function sendSlack(text: string): Promise<boolean> {
  if (!env.SLACK_WEBHOOK_URL) return false;
  try {
    const res = await fetch(env.SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(15_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
