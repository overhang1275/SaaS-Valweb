import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { Grid2X2, List, Upload, Images } from "lucide-react";
import { requireActor } from "@/lib/auth";
import { getValidation } from "@/features/validations/service";
import { listRecordImages } from "@/features/records/images";
import { catalogQuerySchema, DEFAULT_CATALOG_QUERY } from "@/features/records/catalog-query";
import { ListPagination } from "@/components/list-pagination";
import { ImageCatalog } from "@/components/image-catalog";
import { ImageCatalogFilters } from "@/components/image-catalog-filters";
import { HelpPopover } from "@/components/ui/help-popover";

export const metadata = { title: "Imágenes por alfanumérico" };
export default async function ImagesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor(true); const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const validation = await getValidation(actor, id); if (!validation) notFound();
  const raw = await searchParams;
  const parsed = catalogQuerySchema.safeParse(raw);
  const query = parsed.success ? parsed.data : DEFAULT_CATALOG_QUERY;
  const view = raw.view === "grid" ? "grid" : "list";
  const images = await listRecordImages(actor, id, query);
  const base = `/validaciones/${id}/imagenes`, edit = `/validaciones/${id}/editar`;
  const url = (page: number, layout = view) => { const values = new URLSearchParams({ page: String(page), pageSize: String(query.pageSize), search: query.search, searchBy: query.searchBy, state: query.state, view: layout }); if (query.tipo) values.set("tipo", query.tipo); if (query.from) values.set("from", query.from); if (query.until) values.set("until", query.until); return `${base}?${values}`; };
  if (parsed.success && query.page !== images.page) redirect(url(images.page));
  const filtered = Boolean(query.search || query.state !== "all" || query.tipo || query.from || query.until);
  const number = (value: number) => value.toLocaleString("es-MX");
  const pagination = (position: "superior" | "inferior") => <ListPagination page={images.page} pageSize={images.pageSize} total={images.total} href={url} position={position} label="del catálogo" />;
  return <>
    <nav className="breadcrumbs" aria-label="Ruta de navegación"><Link href="/validaciones">Validaciones</Link><span>/</span><Link href={edit}>{validation.name}</Link><span>/</span><span aria-current="page">Imágenes</span></nav>
    <div className="page-heading catalog-heading"><div><h1>Imágenes por alfanumérico</h1><p>{validation.name} · Catálogo de archivos y registros</p></div><Link href={`${edit}?tab=imagenes`} className="button"><Upload size={17} aria-hidden="true" />Cargar imágenes</Link></div>
    <div className="catalog-context"><div><Images size={18} aria-hidden="true" /><p>{validation.activeDatasetId ? "Asociaciones con la base publicada" : "Aún no hay una base publicada"}<span>{validation.activeDatasetId ? "Revisa qué documento corresponde a cada registro." : "Las imágenes cargadas aparecerán sin registro hasta publicar una base."}</span></p></div><HelpPopover label="Cómo se relacionan las imágenes"><p>El nombre del archivo se relaciona con el código alfanumérico de la base publicada. El folio mostrado es un dato distinto.</p><p>Los duplicados y archivos rechazados se revisan en los reportes de importación, desde Imágenes.</p><Link href={`${edit}?tab=imagenes`}>Ver cargas y reportes</Link></HelpPopover></div>
    {!parsed.success && <p className="feedback error" role="alert">Hay filtros inválidos. Mostramos el catálogo sin filtros; revisa las fechas, el tamaño de página y los valores elegidos.</p>}
    <ImageCatalogFilters key={JSON.stringify(query)} query={query} types={images.types} base={base} view={view} />
    <section className="catalog-results" aria-label="Resultados del catálogo"><div className="catalog-results-header"><div><h2>{filtered ? "Resultados filtrados" : "Archivos y registros"}</h2><p className="help">{number(images.total)} {images.total === 1 ? "resultado" : "resultados"} · Ordenados por alfanumérico</p></div><nav className="catalog-view-toggle" aria-label="Vista del catálogo"><Link href={url(images.page, "list")} aria-current={view === "list" ? "page" : undefined}><List size={17} aria-hidden="true" /><span>Lista</span></Link><Link href={url(images.page, "grid")} aria-current={view === "grid" ? "page" : undefined}><Grid2X2 size={17} aria-hidden="true" /><span>Galería</span></Link></nav></div>
    {pagination("superior")}
    {images.rows.length ? <ImageCatalog rows={images.rows} validationId={id} view={view} active={validation.status === "ACTIVE" && validation.showImage && validation.imageMode === "PER_RECORD"} /> : <div className="empty-state catalog-empty"><Images size={34} aria-hidden="true" /><h2>{filtered ? "No hay coincidencias con estos filtros" : "Todavía no hay archivos ni registros"}</h2><p>{filtered ? "Prueba otro código, revisa el campo de búsqueda o limpia los filtros." : "Publica tu base y carga un ZIP de imágenes para relacionarlas por alfanumérico."}</p><Link href={filtered ? `${base}?view=${view}` : `${edit}?tab=imagenes`} className="button button-secondary">{filtered ? "Limpiar filtros" : "Cargar imágenes"}</Link></div>}
    {images.total > 0 && pagination("inferior")}
    </section>
    <Link className="back-link catalog-back" href={edit}>Volver a la validación</Link>
  </>;
}
