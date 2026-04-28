import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import DashboardClient from "./DashboardClient";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

const SORTABLE_FIELDS = new Set([
  "id", "username", "serviceName", "quantity", "remains",
  "status", "chargeValue", "createdAt",
]);

function parseDate(s?: string): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return isNaN(d.getTime()) ? undefined : d;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    user?: string;
    status?: string;
    q?: string;
    from?: string;
    to?: string;
    page?: string;
    sort?: string;
    dir?: string;
  }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));

  const userFilter = sp.user ?? "";

  const userScope: Prisma.OrderWhereInput = userFilter
    ? { username: userFilter }
    : {};

  const ordersWhere: Prisma.OrderWhereInput = { ...userScope };
  if (sp.status) ordersWhere.status = sp.status;

  const from = parseDate(sp.from);
  const to = parseDate(sp.to);
  if (from || to) {
    ordersWhere.createdAt = {};
    if (from) ordersWhere.createdAt.gte = from;
    if (to) {
      const toEnd = new Date(to);
      toEnd.setHours(23, 59, 59, 999);
      ordersWhere.createdAt.lte = toEnd;
    }
  }

  const q = (sp.q ?? "").trim();
  if (q) {
    const numId = Number(q);
    const orFilters: Prisma.OrderWhereInput[] = [
      { serviceName: { contains: q, mode: "insensitive" } },
      { link: { contains: q, mode: "insensitive" } },
      { externalId: { contains: q } },
    ];
    if (Number.isInteger(numId) && numId > 0) {
      orFilters.push({ id: numId });
    }
    ordersWhere.OR = orFilters;
  }

  const sortField = SORTABLE_FIELDS.has(sp.sort ?? "") ? sp.sort! : "createdAt";
  const sortDir: "asc" | "desc" = sp.dir === "asc" ? "asc" : "desc";

  const [
    statsTotalOrders,
    statsStatusGroups,
    statsChargeSum,
    statsLast24h,
    lastSync,
    trackedRows,
    recentSyncs,
    filteredTotal,
    orders,
    statusOptions,
  ] = await Promise.all([
    prisma.order.count({ where: userScope }),
    prisma.order.groupBy({
      by: ["status"],
      _count: { _all: true },
      where: userScope,
    }),
    prisma.order.aggregate({
      _sum: { chargeValue: true },
      where: userScope,
    }),
    prisma.order.count({
      where: { ...userScope, createdAt: { gt: new Date(Date.now() - 86400_000) } },
    }),
    prisma.syncRun.findFirst({ orderBy: { startedAt: "desc" } }),
    prisma.trackedUsername.findMany({
      orderBy: { addedAt: "desc" },
      include: { _count: { select: { orders: true } } },
    }),
    prisma.syncRun.findMany({ orderBy: { startedAt: "desc" }, take: 8 }),
    prisma.order.count({ where: ordersWhere }),
    prisma.order.findMany({
      where: ordersWhere,
      orderBy: { [sortField]: sortDir },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.order.groupBy({ by: ["status"], where: userScope }),
  ]);

  const byStatus = Object.fromEntries(
    statsStatusGroups.map((g) => [g.status.toLowerCase(), g._count._all]),
  );
  const completed = byStatus["completed"] ?? byStatus["complete"] ?? 0;
  const pending = byStatus["pending"] ?? 0;
  const inProgress =
    (byStatus["in_progress"] ?? 0) +
    (byStatus["inprogress"] ?? 0) +
    (byStatus["processing"] ?? 0);
  const canceled = (byStatus["canceled"] ?? 0) + (byStatus["cancelled"] ?? 0);
  const partial = byStatus["partial"] ?? 0;

  return (
    <DashboardClient
      stats={{
        totalOrders: statsTotalOrders,
        completed,
        inProgress,
        pending,
        canceled,
        partial,
        chargeSum: Number(statsChargeSum._sum.chargeValue ?? 0),
        last24h: statsLast24h,
        lastSync: lastSync
          ? {
              startedAt: lastSync.startedAt.toISOString(),
              finishedAt: lastSync.finishedAt?.toISOString() ?? null,
              ordersFetched: lastSync.ordersFetched,
              error: lastSync.error,
            }
          : null,
        trackedActive: trackedRows.filter((r) => r.active).length,
        trackedTotal: trackedRows.length,
        scopeUser: userFilter || null,
      }}
      tracked={trackedRows.map((r) => ({
        id: r.id,
        username: r.username,
        active: r.active,
        note: r.note,
        lastSyncedAt: r.lastSyncedAt?.toISOString() ?? null,
        addedAt: r.addedAt.toISOString(),
        orderCount: r._count.orders,
      }))}
      recentSyncs={recentSyncs.map((r) => ({
        id: r.id,
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt?.toISOString() ?? null,
        usernamesCount: r.usernamesCount,
        ordersFetched: r.ordersFetched,
        ordersInserted: r.ordersInserted,
        ordersUpdated: r.ordersUpdated,
        triggeredBy: r.triggeredBy,
        error: r.error,
      }))}
      orders={{
        list: orders.map((o) => ({
          id: o.id,
          username: o.username,
          serviceName: o.serviceName,
          link: o.link,
          quantity: o.quantity,
          remains: o.remains,
          status: o.status,
          chargeValue: o.chargeValue ? Number(o.chargeValue) : null,
          chargeCurrency: o.chargeCurrency,
          provider: o.provider,
          createdAt: o.createdAt.toISOString(),
        })),
        total: filteredTotal,
        page,
        pageSize: PAGE_SIZE,
        statusOptions: statusOptions.map((s) => s.status),
        usernameOptions: trackedRows.map((r) => r.username),
        filters: {
          user: userFilter,
          status: sp.status ?? "",
          q: sp.q ?? "",
          from: sp.from ?? "",
          to: sp.to ?? "",
        },
        sort: { field: sortField, dir: sortDir },
      }}
    />
  );
}
