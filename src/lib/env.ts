function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

export const env = {
  THORSMM_API_BASE: required("THORSMM_API_BASE"),
  THORSMM_API_KEY: required("THORSMM_API_KEY"),
  SESSION_SECRET: required("SESSION_SECRET"),
  CRON_SECRET: required("CRON_SECRET"),
  SYNC_INTERVAL_MINUTES: Number(process.env.SYNC_INTERVAL_MINUTES ?? 10),
  COUNTER_API_BASE: process.env.COUNTER_API_BASE ?? "https://check.globaprovider.com",
  COUNTER_API_KEY: process.env.COUNTER_API_KEY ?? "",
  SLACK_WEBHOOK_URL: process.env.SLACK_WEBHOOK_URL ?? "",
  // Not eklerken seçilebilecek Slack kanalları. Varsayılan (SLACK_WEBHOOK_URL) +
  // SLACK_NOTE_CHANNELS JSON'undaki [{name,url}] kanalları. URL'ler client'a
  // gitmez; sadece isimler listelenir, gönderim server-side yapılır.
  SLACK_NOTE_CHANNELS: (() => {
    const list: { name: string; url: string }[] = [];
    if (process.env.SLACK_WEBHOOK_URL) list.push({ name: "Varsayılan", url: process.env.SLACK_WEBHOOK_URL });
    try {
      const arr = JSON.parse(process.env.SLACK_NOTE_CHANNELS ?? "[]");
      if (Array.isArray(arr)) for (const c of arr) if (c?.url) list.push({ name: String(c.name ?? "Kanal"), url: String(c.url) });
    } catch { /* geçersiz JSON → yok say */ }
    return list;
  })(),
  // Slack bildirimlerinin başına eklenecek etiket. Gerçek ping için Slack
  // member ID formatı kullanılmalı: "<@U0XXXXXXX>". Düz metin (ör. "@Oğuz
  // Demirbay") sadece görünür, bildirim atmaz.
  SLACK_MENTION: process.env.SLACK_MENTION ?? "@Oğuz Demirbay",
  // thorsmmprovider.com /updates sayfasını izlemek için giriş bilgisi.
  THOR_UPDATES_BASE: process.env.THOR_UPDATES_BASE ?? "https://thorsmmprovider.com",
  THOR_UPDATES_USER: process.env.THOR_UPDATES_USER ?? "",
  THOR_UPDATES_PASS: process.env.THOR_UPDATES_PASS ?? "",
  // /updates bildirimlerinin gideceği Slack webhook (yoksa genel SLACK_WEBHOOK_URL).
  UPDATES_SLACK_WEBHOOK_URL: process.env.UPDATES_SLACK_WEBHOOK_URL ?? "",
  // Vanak Drop sekmesi için ekstra erişim anahtarı. Session login'e ek olarak,
  // bu key girilmeden sayfa açılmaz. Boşsa gate devre dışı kalır.
  VANAK_ACCESS_KEY: process.env.VANAK_ACCESS_KEY ?? "",
  // Harici drop-rate servisi (diğer local proje). Service Drop Rate sekmesi
  // buradan cron ile önceden hesaplanmış oranları çeker (proxy ile, key gizli).
  DROPRATE_API_BASE: process.env.DROPRATE_API_BASE ?? "",
  DROPRATE_API_KEY: process.env.DROPRATE_API_KEY ?? "",
  // Vanak API'lerinin izinli origin'i (CORS). Boşsa isteğin kendi host'u (same-origin)
  // kabul edilir; set edilirse yalnızca bu origin'den çağrı yapılabilir.
  APP_ORIGIN: process.env.APP_ORIGIN ?? "",
};
