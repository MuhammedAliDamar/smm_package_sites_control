import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import type { Prisma } from "@prisma/client";
import VanakClient from "../dashboard/vanak/VanakClient";
import VanakGate from "../dashboard/vanak/VanakGate";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const USERNAME = "vanak";
const COMPLETED = ["completed", "Completed", "complete", "Complete"];

// Nullable sayısal kolonlarda sıralamada null'lar sona.
const NULLS_LAST = new Set(["quantity", "startCount", "currentCount", "dropRate"]);
const SORTABLE = new Set([
  "id", "serviceName", "link", "startCount", "quantity", "currentCount", "dropRate", "createdAt",
]);

export default async function VanakPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; drop?: string; q?: string; sort?: string; dir?: string }>;
}) {
  // --- Key gate: admin login YOK, sadece vanak_key cookie'si gerekli ---
  const gateEnabled = Boolean(env.VANAK_ACCESS_KEY);
  if (gateEnabled) {
    const jar = await cookies();
    if (jar.get("vanak_key")?.value !== env.VANAK_ACCESS_KEY) {
      return <VanakGate />;
    }
  }

  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));

  // Drop hesabıyla aynı kriter: min qty 500, max start count 2000.
  const baseWhere: Prisma.OrderWhereInput = {
    username: USERNAME,
    status: { in: COMPLETED },
    quantity: { gte: 500 },
    startCount: { lte: 2000 },
  };

  // "drop" filtresi
  const listWhere: Prisma.OrderWhereInput = { ...baseWhere };
  if (sp.drop === "dropped") listWhere.dropRate = { gt: 0 };
  else if (sp.drop === "checked") listWhere.dropRate = { not: null };
  else if (sp.drop === "unchecked") listWhere.dropRate = null;

  // Servis araması: serviceName (içerir) veya serviceId (tam) veya order id.
  const q = (sp.q ?? "").trim();
  if (q) {
    const or: Prisma.OrderWhereInput[] = [
      { serviceName: { contains: q, mode: "insensitive" } },
    ];
    const num = Number(q);
    if (Number.isInteger(num) && num > 0) {
      or.push({ serviceId: num }, { id: num });
    }
    listWhere.OR = or;
  }

  const sortField = SORTABLE.has(sp.sort ?? "") ? sp.sort! : "createdAt";
  const sortDir: "asc" | "desc" = sp.dir === "asc" ? "asc" : "desc";
  const orderBy: Prisma.OrderOrderByWithRelationInput = NULLS_LAST.has(sortField)
    ? { [sortField]: { sort: sortDir, nulls: "last" } }
    : { [sortField]: sortDir };

  const [totalCompleted, checkedCount, droppedCount, filteredTotal, orders] =
    await Promise.all([
      prisma.order.count({ where: baseWhere }),
      prisma.order.count({ where: { ...baseWhere, dropRate: { not: null } } }),
      prisma.order.count({ where: { ...baseWhere, dropRate: { gt: 0 } } }),
      prisma.order.count({ where: listWhere }),
      prisma.order.findMany({
        where: listWhere,
        orderBy,
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
    ]);

  return (
    <VanakClient
      stats={{ totalCompleted, checkedCount, droppedCount }}
      orders={{
        list: orders.map((o) => ({
          id: o.id,
          serviceId: o.serviceId,
          serviceName: o.serviceName,
          link: o.link,
          quantity: o.quantity,
          startCount: o.startCount,
          currentCount: o.currentCount,
          dropRate: o.dropRate ? Number(o.dropRate) : null,
          dropCheckedAt: o.dropCheckedAt?.toISOString() ?? null,
          status: o.status,
          createdAt: o.createdAt.toISOString(),
        })),
        total: filteredTotal,
        page,
        pageSize: PAGE_SIZE,
        drop: sp.drop ?? "",
        q,
        sort: sortField,
        dir: sortDir,
      }}
    />
  );
}
