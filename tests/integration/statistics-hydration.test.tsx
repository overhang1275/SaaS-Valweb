import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/auth", () => ({ requireActor: async () => ({ id: "user", role: "CLIENT", tenantId: "tenant", sessionVersion: 0 }) }));
vi.mock("@/features/statistics/service", () => ({
  parseStatisticsPeriod: () => 7,
  getUsageStatistics: async () => ({
    period: 7,
    selectedTenantId: "tenant",
    tenants: [],
    days: Array.from({ length: 7 }, (_, index) => ({ date: `2026-10-${String(index + 1).padStart(2, "0")}`, label: `${index + 1} oct`, found: 1n, notFound: 0n, queries: index === 0 ? 1n : 0n })),
    found: 1n,
    notFound: 0n,
    queries: 1n,
    activeValidations: 1,
    topValidations: [],
  }),
}));

import StatisticsPage from "@/app/(panel)/estadisticas/page";

it("renders chart tooltips outside SVG rect elements", async () => {
  const page = await StatisticsPage({ searchParams: Promise.resolve({ periodo: "7" }) });
  const markup = renderToStaticMarkup(page);

  expect(markup).toMatch(/<g[^>]*><title>1 oct: 1 consultas<\/title><rect/);
  expect(markup).not.toMatch(/<rect\b[^>]*>[\s\S]*?<title>/);
});
