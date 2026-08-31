import { config } from "dotenv";
config({ path: ".env.local" });
config();

const DROP_CHECK_HOURS = [8, 14, 22];

async function main() {
  const { runSync } = await import("../src/lib/sync");
  const { runDropCheck } = await import("../src/lib/dropCheck");
  const { runRefillCheck } = await import("../src/lib/refillCheck");
  const { runUpdatesCheck } = await import("../src/lib/updatesNotify");
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

  async function refillTick() {
    const t0 = Date.now();
    try {
      const r = await runRefillCheck();
      const ms = Date.now() - t0;
      if (r.checked > 0) {
        console.log(
          `[${new Date().toISOString()}] REFILL CHECK: checked=${r.checked} noIncrease=${r.noIncrease} increased=${r.increased} ${ms}ms`,
        );
      }
    } catch (err) {
      console.error(`[${new Date().toISOString()}] refill check HATA:`, err);
    }
  }

  async function updatesTick() {
    const t0 = Date.now();
    try {
      const r = await runUpdatesCheck();
      const ms = Date.now() - t0;
      if (r.seeded) {
        console.log(`[${new Date().toISOString()}] UPDATES: baseline seeded (${r.total} rows) ${ms}ms`);
      } else if ((r.new ?? 0) > 0 || !r.ok) {
        console.log(
          `[${new Date().toISOString()}] UPDATES: total=${r.total ?? "-"} new=${r.new ?? 0} sent=${r.sent ?? 0} ${ms}ms${r.error ? ` ERR: ${r.error}` : ""}`,
        );
      }
    } catch (err) {
      console.error(`[${new Date().toISOString()}] updates check HATA:`, err);
    }
  }

  await tick();
  setInterval(tick, intervalMs);
  setInterval(dropTick, 60_000);
  // Refill'lerin 24 saatlik kontrolü: saatte bir tarar, süresi dolanı işler.
  setInterval(refillTick, 60 * 60_000);
  await refillTick();
  // /updates izleme: 10 dakikada bir bugüne ait yeni satırları Telegram'a bildir.
  setInterval(updatesTick, 10 * 60_000);
  await updatesTick();
}

main().catch((e) => { console.error(e); process.exit(1); });
