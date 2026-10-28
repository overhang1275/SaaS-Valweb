import { z } from "zod";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !value.startsWith("0000") && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "La fecha no es válida.");
const optionalDate = z.preprocess(value => value === "" ? undefined : value, date.optional());

export const catalogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().pipe(z.union([z.literal(25), z.literal(50)])).default(50),
  search: z.string().trim().max(128).default(""),
  searchBy: z.enum(["alfanum", "folio", "filename"]).default("alfanum"),
  state: z.enum(["all", "linked", "missing", "orphan"]).default("all"),
  tipo: z.string().trim().max(500).optional().transform(value => value || undefined),
  from: optionalDate,
  until: optionalDate,
}).refine(query => !query.from || !query.until || query.from <= query.until, {
  message: "La fecha inicial debe ser anterior o igual a la fecha final.", path: ["until"],
});

export type CatalogQuery = z.output<typeof catalogQuerySchema>;
export const DEFAULT_CATALOG_QUERY = catalogQuerySchema.parse({});
export type CatalogRow = {
  key: string;
  alfanum: string;
  folio: string | null;
  tipo: string | null;
  state: "linked" | "missing" | "orphan";
  image: null | {
    id: string; originalName: string; width: number; height: number;
    size: number; createdAt: Date; updatedAt: Date;
  };
};
