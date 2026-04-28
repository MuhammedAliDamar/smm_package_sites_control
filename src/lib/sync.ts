import { prisma } from "./db";
import { fetchOrdersForUser, type ThorOrder } from "./thorsmm";

function toOrderRow(o: ThorOrder) {
  return {
    id: o.id,
    externalId: o.external_id ?? null,
    username: o.user,
    serviceId: o.service_id ?? null,
    serviceName: o.service_name ?? null,
    serviceType: o.service_type ?? null,
    provider: o.provider ?? null,
    creationType: o.creation_type ?? null,
    mode: o.mode ?? null,
    link: o.link ?? null,
    quantity: o.quantity ?? null,
    startCount: o.start_count ?? null,
    remains: o.remains ?? null,
    status: o.status,
    chargeValue: o.charge?.value ? o.charge.value : null,
    chargeCurrency: o.charge?.currency_code ?? null,
    providerChargeValue: o.provider_charge?.value ? o.provider_charge.value : null,
    ipAddress: o.ip_address ?? null,
    createdAt: new Date(o.created_timestamp * 1000),
    raw: o as unknown as object,
  };
}

export async function runSync(opts: { triggeredBy?: string } = {}) {
  const triggeredBy = opts.triggeredBy ?? "cron";
  const run = await prisma.syncRun.create({
    data: { triggeredBy },
  });

  let ordersFetched = 0;
  let ordersInserted = 0;
  let ordersUpdated = 0;
  let errorMessage: string | null = null;

  try {
    const tracked = await prisma.trackedUsername.findMany({
      where: { active: true },
    });

    for (const t of tracked) {
      try {
        const orders = await fetchOrdersForUser(t.username);
        ordersFetched += orders.length;

        for (const o of orders) {
          const row = toOrderRow(o);
          const existing = await prisma.order.findUnique({
            where: { id: row.id },
            select: { id: true },
          });
          await prisma.order.upsert({
            where: { id: row.id },
            create: row,
            update: {
              status: row.status,
              remains: row.remains,
              startCount: row.startCount,
              chargeValue: row.chargeValue,
              chargeCurrency: row.chargeCurrency,
              providerChargeValue: row.providerChargeValue,
              raw: row.raw,
            },
          });
          if (existing) ordersUpdated++;
          else ordersInserted++;
        }

        await prisma.trackedUsername.update({
          where: { id: t.id },
          data: { lastSyncedAt: new Date() },
        });
      } catch (err) {
        errorMessage = (errorMessage ? errorMessage + "\n" : "") +
          `[${t.username}] ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        usernamesCount: tracked.length,
        ordersFetched,
        ordersInserted,
        ordersUpdated,
        error: errorMessage,
      },
    });

    return {
      runId: run.id,
      usernamesCount: tracked.length,
      ordersFetched,
      ordersInserted,
      ordersUpdated,
      error: errorMessage,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.syncRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), error: msg },
    });
    throw err;
  }
}
