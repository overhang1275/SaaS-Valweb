import { expect, it } from "vitest";
import { catalogQuerySchema, DEFAULT_CATALOG_QUERY } from "../../src/features/records/catalog-query";

it("parses bounded catalog filters and blank dates", () => {
  expect(catalogQuerySchema.parse({ page: "2", pageSize: "25", search: "  ab  ", from: "", until: "", tipo: "" })).toEqual({
    ...DEFAULT_CATALOG_QUERY, page: 2, pageSize: 25, search: "ab", from: undefined, until: undefined, tipo: undefined,
  });
});
it("rejects invalid enums, ranges, dates and unbounded pages", () => {
  for (const query of [{ page: 0 }, { page: 1000001 }, { page: "x" }, { pageSize: 100 }, { searchBy: "sql" }, { state: "duplicate" },
    { search: "x".repeat(129) }, { from: "2026-02-30" }, { from: "0000-01-01" }, { from: "2026-10-28", until: "2026-10-27" }]) {
    expect(catalogQuerySchema.safeParse(query).success).toBe(false);
  }
});
