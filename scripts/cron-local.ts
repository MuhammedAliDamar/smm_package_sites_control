import { config } from "dotenv";
config({ path: ".env.local" });
config();

async function main() {
  const { runSync } = await import("../src/lib/sync");
  const minutes = Number(process.env.SYNC_INTERVAL_MINUTES ?? 10);
  const intervalMs = minutes * 60 * 1000;
  console.log(`Local cron çalışıyor: her ${minutes} dakikada bir senkron.`);
  console.log("Ctrl+C ile durdurun.\n");

  async function tick() {
    const t0 = Date.now();
    try {
      const r = await runSync({ triggeredBy: "local-cron" });
      const ms = Date.now() - t0;
      console.log(
        `[${new Date().toISOString()}] run#${r.runId} users=${r.usernamesCount} fetched=${r.ordersFetched} new=${r.ordersInserted} upd=${r.ordersUpdated} ${ms}ms${r.error ? ` ERR: ${r.error.slice(0, 200)}` : ""}`,
      );
    } catch (err) {
      console.error(`[${new Date().toISOString()}] cron HATA:`, err);
    }
  }

  await tick();
  setInterval(tick, intervalMs);
}

main().catch((e) => { console.error(e); process.exit(1); });
