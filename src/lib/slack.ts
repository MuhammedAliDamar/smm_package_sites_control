import { env } from "./env";

/**
 * Slack incoming-webhook'una basit metin bildirimi gönderir.
 * Webhook tanımlı değilse sessizce no-op (dev ortamı patlamasın).
 * Bildirim hatası ana akışı bozmamalı; hata fırlatmaz, boolean döner.
 */
/** Verilen Slack incoming-webhook URL'ine metin gönderir. */
export async function postWebhook(url: string, text: string): Promise<boolean> {
  if (!url) return false;
  try {
    const res = await fetch(url, {
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

export async function sendSlack(text: string): Promise<boolean> {
  return postWebhook(env.SLACK_WEBHOOK_URL, text);
}
