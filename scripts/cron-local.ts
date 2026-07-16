import { config } from "dotenv";
config({ path: ".env.local" });
config();

const DROP_CHECK_HOURS = [8, 14, 22];

async function main() {
  const { runSync } = await import("../src/lib/sync");
  const { runDropCheck } = await import("../src/lib/dropCheck");
  const minutes = Number(process.env.SYNC_INTERVAL_MINUTES ?? 10);
  const intervalMs = minutes * 60 * 1000;
  console.log(`Local cron çalışıyor: her ${minutes} dakikada bir senkron.`);
  console.log(`Drop check saatleri: ${DROP_CHECK_HOURS.join(", ")}`);
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

  let lastDropCheckHour = -1;
  async function dropTick() {
    const hour = new Date().getHours();
    if (!DROP_CHECK_HOURS.includes(hour) || hour === lastDropCheckHour) return;
    lastDropCheckHour = hour;
    const t0 = Date.now();
    try {
      const r = await runDropCheck();
      const ms = Date.now() - t0;
      console.log(
        `[${new Date().toISOString()}] DROP CHECK: checked=${r.checked} success=${r.success} fail=${r.fail} ${ms}ms`,
      );
    } catch (err) {
      console.error(`[${new Date().toISOString()}] drop check HATA:`, err);
    }
  }

  await tick();
  setInterval(tick, intervalMs);
  setInterval(dropTick, 60_000);
}

main().catch((e) => { console.error(e); process.exit(1); });
