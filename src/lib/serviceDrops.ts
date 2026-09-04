import { prisma } from "./db";
import { checkOrder } from "./checker";

// Thor GENELİNDE servis-bazlı periyot drop hesabı (tüm kullanıcılar).
// Kapsam: son 30 günde completed siparişi olan servisler. Her servis × periyot N
// için yaşı ~N gün olan siparişleri counter API ile örnekler, ortalama drop'u
// ServiceDropRate.periodsData'ya yazar. Rate-limit yok → yüksek paralellik.

const COMPLETED = ["completed", "Completed", "complete", "Complete"];
export const PERIODS = [3, 7, 10, 15, 30] as const;
const MONTH_MS = 30 * 86400_000;

const CANDIDATES = 60;
const MAX_CHECK = 30;
const CONCURRENCY = 20;
const MIN_QUANTITY = 500;
const MAX_START_COUNT = 2000;
const OVER_LIMIT = 1.2;
const PROGRESS_KEY = "serviceDropCompute";

type OrderDetail = {
  orderId: number;
  dropRate: number;
  link: string | null;
  orderDate: string;
  quantity: number | null;
  startCount: number | null;
  currentCount: number;
};
type PeriodResult = { avgDropRate: number | null; checkedCount: number; totalFound: number; checkedAt: string; orders?: OrderDetail[] };
type PeriodsData = Record<string, PeriodResult>;

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return out;
}

async function computeServicePeriod(serviceId: number, days: number): Promise<PeriodResult> {
  const now = Date.now();
  const targetCutoff = new Date(now - days * 86400_000);
  const backLimit = new Date(now - days * 2 * 86400_000);
  const baseWhere = {
    serviceId,
    status: { in: COMPLETED },
    link: { not: null },
    quantity: { gte: MIN_QUANTITY },
    startCount: { lte: MAX_START_COUNT },
  } as const;
  const select = { id: true, link: true, quantity: true, startCount: true, serviceName: true, serviceType: true, createdAt: true } as const;

  const primary = await prisma.order.findMany({
    where: { ...baseWhere, createdAt: { lte: targetCutoff, gte: backLimit } },
    orderBy: { createdAt: "desc" },
    take: CANDIDATES,
    select,
  });

  let candidates = primary;
  if (primary.length < CANDIDATES) {
    const recent = await prisma.order.findMany({
      where: { ...baseWhere, createdAt: { gt: targetCutoff } },
      orderBy: { createdAt: "asc" },
      take: CANDIDATES - primary.length,
      select,
    });
    candidates = [...primary, ...recent];
  }

  const orders: OrderDetail[] = [];
  await mapPool(candidates, CONCURRENCY, async (o) => {
    if (orders.length >= MAX_CHECK) return;
    const r = await checkOrder(o);
    if (r.error || r.currentCount == null || r.dropRate == null) return;
    if (o.startCount != null && o.quantity != null && r.currentCount > o.startCount + o.quantity * OVER_LIMIT) return;
    if (orders.length < MAX_CHECK) {
      orders.push({
        orderId: o.id,
        dropRate: r.dropRate,
        link: o.link,
        orderDate: o.createdAt.toISOString(),
        quantity: o.quantity,
        startCount: o.startCount,
        currentCount: r.currentCount,
      });
    }
  });

  const drops = orders.map((o) => o.dropRate);
  const avg = drops.length ? parseFloat((drops.reduce((a, b) => a + b, 0) / drops.length).toFixed(2)) : null;
  return { avgDropRate: avg, checkedCount: orders.length, totalFound: candidates.length, checkedAt: new Date().toISOString(), orders };
}

async function setProgress(p: { running: boolean; total: number; done: number; startedAt: string; finishedAt?: string; error?: string }) {
  await prisma.setting.upsert({
    where: { key: PROGRESS_KEY },
    create: { key: PROGRESS_KEY, value: JSON.stringify(p) },
    update: { value: JSON.stringify(p) },
  });
}

export async function getComputeProgress() {
  const row = await prisma.setting.findUnique({ where: { key: PROGRESS_KEY } });
  if (!row) return { running: false, total: 0, done: 0, startedAt: null as string | null, finishedAt: null as string | null };
  try {
    return JSON.parse(row.value);
  } catch {
    return { running: false, total: 0, done: 0, startedAt: null, finishedAt: null };
  }
}

async function serviceName(serviceId: number): Promise<string | null> {
  const one = await prisma.order.findFirst({ where: { serviceId }, orderBy: { createdAt: "desc" }, select: { serviceName: true } });
  return one?.serviceName ?? null;
}

export async function computeOnePeriod(serviceId: number, days: number) {
  const result = await computeServicePeriod(serviceId, days);
  const existing = await prisma.serviceDropRate.findUnique({ where: { serviceId } });
  const nm = await serviceName(serviceId);
  const periodsData: PeriodsData = { ...((existing?.periodsData as PeriodsData) ?? {}), [String(days)]: result };
  await prisma.serviceDropRate.upsert({
    where: { serviceId },
    create: { serviceId, serviceName: nm, periodsData },
    update: { serviceName: nm, periodsData },
  });
  return { serviceId, days, result };
}

export async function computeOneService(serviceId: number) {
  const nm = await serviceName(serviceId);
  const periodsData: PeriodsData = {};
  for (const d of PERIODS) periodsData[String(d)] = await computeServicePeriod(serviceId, d);
  await prisma.serviceDropRate.upsert({
    where: { serviceId },
    create: { serviceId, serviceName: nm, periodsData },
    update: { serviceName: nm, periodsData },
  });
  return { serviceId, periodsData };
}

// Son 30 günde completed siparişi olan servis id'leri.
async function lastMonthServiceIds(): Promise<number[]> {
  const since = new Date(Date.now() - MONTH_MS);
  const groups = await prisma.order.groupBy({
    by: ["serviceId"],
    where: { status: { in: COMPLETED }, serviceId: { not: null }, createdAt: { gte: since } },
    _count: { _all: true },
  });
  return groups.map((g) => g.serviceId).filter((v): v is number => v != null);
}

let inFlight = false;

// Son 30 günde siparişi olan TÜM servisler × PERIODS için hesaplar.
export async function computeAllServiceDrops(): Promise<{ started: boolean; services?: number; jobs?: number }> {
  if (inFlight) return { started: false };
  inFlight = true;
  const startedAt = new Date().toISOString();
  try {
    const serviceIds = await lastMonthServiceIds();
    const total = serviceIds.length * PERIODS.length;
    let done = 0;
    await setProgress({ running: true, total, done, startedAt });

    for (const serviceId of serviceIds) {
      const nm = await serviceName(serviceId);
      const periodsData: PeriodsData = {};
      for (const d of PERIODS) {
        periodsData[String(d)] = await computeServicePeriod(serviceId, d);
        done++;
        await setProgress({ running: true, total, done, startedAt });
      }
      await prisma.serviceDropRate.upsert({
        where: { serviceId },
        create: { serviceId, serviceName: nm, periodsData },
        update: { serviceName: nm, periodsData },
      });
    }

    await setProgress({ running: false, total, done, startedAt, finishedAt: new Date().toISOString() });
    return { started: true, services: serviceIds.length, jobs: total };
  } catch (e) {
    await setProgress({ running: false, total: 0, done: 0, startedAt, finishedAt: new Date().toISOString(), error: e instanceof Error ? e.message : "error" });
    return { started: true };
  } finally {
    inFlight = false;
  }
}

// Okuma: son 30 günde completed siparişi olan servisleri drop verisiyle döndürür.
export async function readServiceDrops() {
  const since = new Date(Date.now() - MONTH_MS);
  const grouped = await prisma.order.groupBy({
    by: ["serviceId"],
    where: { status: { in: COMPLETED }, serviceId: { not: null }, createdAt: { gte: since } },
    _count: { _all: true },
  });
  if (!grouped.length) return { totalServices: 0, totalOrders: 0, services: [] };

  const serviceIds = grouped.map((g) => g.serviceId).filter((v): v is number => v != null);
  const [rates, names] = await Promise.all([
    prisma.serviceDropRate.findMany({ where: { serviceId: { in: serviceIds } } }),
    prisma.order.findMany({ where: { serviceId: { in: serviceIds } }, distinct: ["serviceId"], select: { serviceId: true, serviceName: true } }),
  ]);
  const rateMap = new Map(rates.map((r) => [r.serviceId, r]));
  const nameMap = new Map(names.map((n) => [n.serviceId, n]));

  let totalOrders = 0;
  const services = grouped
    .filter((g) => g.serviceId != null)
    .map((g) => {
      const serviceId = g.serviceId as number;
      totalOrders += g._count._all;
      const rate = rateMap.get(serviceId);
      const pd = (rate?.periodsData as PeriodsData | undefined) ?? {};
      const dropRates: Record<string, number | null> = {};
      const periodCounts: Record<string, number> = {};
      for (const d of PERIODS) {
        const v = pd[String(d)]?.avgDropRate;
        dropRates[String(d)] = v === null || v === undefined || isNaN(Number(v)) ? null : Number(v);
        periodCounts[String(d)] = pd[String(d)]?.checkedCount ?? 0;
      }
      const vals = Object.values(dropRates).filter((v): v is number => v !== null);
      const avgDropRate = vals.length ? parseFloat((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2)) : null;
      const processedCount = PERIODS.reduce((sum, d) => sum + (pd[String(d)]?.checkedCount ?? 0), 0);
      const info = nameMap.get(serviceId);
      return {
        serviceId,
        serviceName: rate?.serviceName ?? info?.serviceName ?? null,
        orderCount: g._count._all,
        isTracked: Boolean(rate),
        dropRates,
        periodCounts,
        avgDropRate,
        processedCount,
        lastCheckedAt: rate?.updatedAt?.toISOString() ?? null,
      };
    })
    .sort((a, b) => b.orderCount - a.orderCount);

  return { totalServices: services.length, totalOrders, services };
}

export async function readPeriodOrders(serviceId: number, days: number) {
  const rate = await prisma.serviceDropRate.findUnique({ where: { serviceId } });
  const pd = (rate?.periodsData as PeriodsData | undefined) ?? {};
  const p = pd[String(days)];
  const orders = (p?.orders ?? []).slice().sort((a, b) => b.dropRate - a.dropRate);
  return { serviceId, serviceName: rate?.serviceName ?? null, days, avgDropRate: p?.avgDropRate ?? null, checkedCount: p?.checkedCount ?? 0, orders };
}
