import { prisma } from "@/lib/prisma";
import { currentActor, type Actor } from "@/features/identity/service";
import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";

export type StatisticsPeriod = 7 | 30 | 90;
const idSchema = z.uuid();
const periodSchema = z.enum(["7", "30", "90"]).transform(value => Number(value) as StatisticsPeriod);

export function parseStatisticsPeriod(value: string | undefined): StatisticsPeriod {
  const parsed = periodSchema.safeParse(value);
  return parsed.success ? parsed.data : 30;
}

function utcDate(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export async function getUsageStatistics(actor: Actor, period: StatisticsPeriod, requestedTenantId?: string) {
  return prisma.$transaction(async tx => {
    const user = await currentActor(tx, actor);
    const tenants = user.role === "ADMIN"
      ? await tx.tenant.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } })
      : [];
    const selectedTenantId = user.role === "CLIENT"
      ? user.tenantId!
      : requestedTenantId && idSchema.safeParse(requestedTenantId).success && tenants.some(tenant => tenant.id === requestedTenantId)
        ? requestedTenantId
        : undefined;
    const end = utcDate(new Date());
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - period + 1);
    const validationScope: Prisma.ValidationWhereInput = {
      status: { not: "DELETED" },
      deletedAt: null,
      ...(selectedTenantId ? { tenantId: selectedTenantId } : {}),
    };
    const statWhere: Prisma.ValidationDailyStatWhereInput = {
      date: { gte: start, lte: end },
      validation: { is: validationScope },
    };

    const [dailyRows, groupedValidations, activeValidations] = await Promise.all([
      tx.validationDailyStat.groupBy({
        by: ["date"],
        where: statWhere,
        _sum: { found: true, notFound: true },
        orderBy: { date: "asc" },
      }),
      tx.validationDailyStat.groupBy({
        by: ["validationId"],
        where: statWhere,
        _sum: { found: true, notFound: true },
      }),
      tx.validation.count({
        where: {
          ...validationScope,
          status: "ACTIVE",
          tenant: { is: { status: "ACTIVE" } },
        },
      }),
    ]);

    const dailyByDate = new Map(dailyRows.map(row => [row.date.toISOString().slice(0, 10), {
      found: row._sum.found ?? 0n,
      notFound: row._sum.notFound ?? 0n,
    }]));
    const days = Array.from({ length: period }, (_, index) => {
      const date = new Date(start);
      date.setUTCDate(start.getUTCDate() + index);
      const dateKey = date.toISOString().slice(0, 10);
      const totals = dailyByDate.get(dateKey) ?? { found: 0n, notFound: 0n };
      return {
        date: dateKey,
        label: new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone: "UTC" }).format(date),
        ...totals,
      };
    });
    const totals = days.reduce((sum, day) => ({ found: sum.found + day.found, notFound: sum.notFound + day.notFound }), { found: 0n, notFound: 0n });
    const validationIds = groupedValidations.map(row => row.validationId);
    const validations = validationIds.length ? await tx.validation.findMany({
      where: { ...validationScope, id: { in: validationIds } },
      select: { id: true, name: true, tenant: { select: { name: true } } },
    }) : [];
    const validationById = new Map(validations.map(validation => [validation.id, validation]));
    const topValidations = groupedValidations
      .map(row => {
        const validation = validationById.get(row.validationId);
        return validation ? {
          id: validation.id,
          name: validation.name,
          tenantName: validation.tenant.name,
          found: row._sum.found ?? 0n,
          notFound: row._sum.notFound ?? 0n,
          queries: (row._sum.found ?? 0n) + (row._sum.notFound ?? 0n),
        } : null;
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a, b) => a.queries === b.queries ? a.name.localeCompare(b.name, "es-MX") : a.queries > b.queries ? -1 : 1)
      .slice(0, 5);

    return {
      period,
      selectedTenantId,
      tenants,
      days: days.map(day => ({ ...day, queries: day.found + day.notFound })),
      found: totals.found,
      notFound: totals.notFound,
      queries: totals.found + totals.notFound,
      activeValidations,
      topValidations,
    };
  }, { isolationLevel: "RepeatableRead" });
}
