import { z } from "zod";

const pagination = {
  q: z.string().trim().max(128).default(""),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().pipe(z.union([z.literal(25), z.literal(50)])).default(25),
};
export const tenantListQuerySchema = z.object({ ...pagination, estado: z.enum(["", "ACTIVE", "SUSPENDED"]).default("") });
export const userListQuerySchema = z.object({ ...pagination, estado: z.enum(["", "ACTIVE", "INVITED", "DISABLED"]).default(""), rol: z.enum(["", "ADMIN", "CLIENT", "CONSULTATION_ONLY"]).default(""), cuenta: z.string().trim().max(128).default("") });
export type TenantListQuery = z.output<typeof tenantListQuerySchema>;
export type UserListQuery = z.output<typeof userListQuerySchema>;

export function identityListUrl(base: string, query: TenantListQuery | UserListQuery, page: number) {
  return `${base}?${new URLSearchParams(Object.entries({ ...query, page }).map(([key, value]) => [key, String(value)]))}`;
}
