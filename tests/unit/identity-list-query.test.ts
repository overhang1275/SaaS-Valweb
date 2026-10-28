import { expect, it } from "vitest";
import { tenantListQuerySchema, userListQuerySchema, identityListUrl } from "../../src/features/identity/list-query";

it("parses bounded identity filters and preserves their values in page links", () => {
  const query = userListQuerySchema.parse({ q: "  Ana & José  ", page: "2", pageSize: "50", estado: "INVITED", rol: "CLIENT", cuenta: "  Acme  " });
  expect(query).toEqual({ q: "Ana & José", page: 2, pageSize: 50, estado: "INVITED", rol: "CLIENT", cuenta: "Acme" });
  const url = new URL(identityListUrl("/admin/usuarios", query, 3), "http://localhost");
  expect(Object.fromEntries(url.searchParams)).toEqual({ ...query, page: "3", pageSize: "50" });
  expect(tenantListQuerySchema.parse({})).toEqual({ q: "", estado: "", page: 1, pageSize: 25 });
});
it("rejects repeated parameters, unknown enums and unbounded requests", () => {
  for (const schema of [tenantListQuerySchema, userListQuerySchema]) {
    for (const query of [{ q: ["one", "two"] }, { q: "x".repeat(129) }, { estado: "OTHER" }, { page: 0 }, { page: "x" }, { page: 1000001 }, { pageSize: 100 }]) expect(schema.safeParse(query).success).toBe(false);
  }
  expect(userListQuerySchema.safeParse({ rol: "ROOT" }).success).toBe(false);
  expect(userListQuerySchema.safeParse({ cuenta: "x".repeat(129) }).success).toBe(false);
});
