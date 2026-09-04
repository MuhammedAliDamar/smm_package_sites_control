import { config } from "dotenv";
config({ path: ".env.local" });
config();

const DROP_CHECK_HOURS = [8, 14, 22];

async function main() {
  const { runSync } = await import("../src/lib/sync");
  const { runDropCheck } = await import("../src/lib/dropCheck");
  const { runRefillCheck } = await import("../src/lib/refillCheck");
  const { runRefillReminders } = await import("../src/lib/refillReminders");
  const { runUpdatesCheck } = await import("../src/lib/updatesNotify");
  const { computeAllVanakServiceDrops } = await import("../src/lib/vanakDrops");
  const VANAK_DROPS_HOUR = 4; // her gün 04:00'te servis drop rate'leri hesapla
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

  async function refillReminderTick() {
    try {
      const r = await runRefillReminders();
      if (r.sent > 0) console.log(`[${new Date().toISOString()}] REFILL REMINDER: sent=${r.sent}`);
    } catch (err) {
      console.error(`[${new Date().toISOString()}] refill reminder HATA:`, err);
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

  let lastVanakDropsDay = -1;
  async function vanakDropsTick() {
    const now = new Date();
    if (now.getHours() !== VANAK_DROPS_HOUR || now.getDate() === lastVanakDropsDay) return;
    lastVanakDropsDay = now.getDate();
    const t0 = Date.now();
    try {
      const r = await computeAllVanakServiceDrops();
      console.log(
        `[${new Date().toISOString()}] VANAK DROPS: started=${r.started} services=${r.services ?? "-"} jobs=${r.jobs ?? "-"} ${Date.now() - t0}ms`,
      );
    } catch (err) {
      console.error(`[${new Date().toISOString()}] vanak drops HATA:`, err);
    }
  }

  await tick();
  setInterval(tick, intervalMs);
  setInterval(dropTick, 60_000);
  setInterval(vanakDropsTick, 60_000);
  // Refill'lerin 24 saatlik kontrolü: saatte bir tarar, süresi dolanı işler.
  setInterval(refillTick, 60 * 60_000);
  await refillTick();
  // 5 saatlik hatırlatmalar: her 30 dk'da tara, süresi geleni gönder.
  setInterval(refillReminderTick, 30 * 60_000);
  await refillReminderTick();
  // /updates izleme: 10 dakikada bir bugüne ait yeni satırları Telegram'a bildir.
  setInterval(updatesTick, 10 * 60_000);
  await updatesTick();
}

main().catch((e) => { console.error(e); process.exit(1); });
