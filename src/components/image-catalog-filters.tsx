"use client";

import { useState } from "react";
import type { CatalogQuery } from "@/features/records/catalog-query";
import { SearchFilters, SearchFilterInput, SearchFilterOptions } from "./search-filters";

export function ImageCatalogFilters({ query, types, base, view }: { query: CatalogQuery; types: string[]; base: string; view: "list" | "grid" }) {
  const [searchBy, setSearchBy] = useState(query.searchBy);
  const active = Boolean(query.search || query.state !== "all" || query.tipo || query.from || query.until);
  const secondary = [query.tipo, query.from, query.until].filter(Boolean).length;
  return <SearchFilters action={base} active={active} clearHref={`${base}?view=${view}`}
    help={<p className="help" id="catalog-search-help">Busca por el inicio del {searchBy === "folio" ? "folio, conservando sus ceros" : searchBy === "filename" ? "nombre del archivo" : "código alfanumérico"}. Las asociaciones corresponden a la base publicada actual.</p>}
    advanced={<SearchFilterOptions count={secondary} help={<p className="help">Fechas de carga de la imagen, en horario de Ciudad de México. Al filtrar por fecha se excluyen los registros sin imagen. Aplica con Buscar.</p>}>
      <div className="field"><label htmlFor="catalog-type">Tipo de documento</label><input id="catalog-type" name="tipo" list="catalog-types" defaultValue={query.tipo ?? ""} maxLength={128} placeholder="Todos los tipos" /><datalist id="catalog-types">{types.map(type => <option key={type} value={type} />)}</datalist></div>
      <div className="field"><label htmlFor="catalog-from">Carga desde</label><input id="catalog-from" name="from" type="date" defaultValue={query.from ?? ""} /></div>
      <div className="field"><label htmlFor="catalog-until">Carga hasta</label><input id="catalog-until" name="until" type="date" defaultValue={query.until ?? ""} /></div>
      <div className="field"><label htmlFor="catalog-size">Por página</label><select id="catalog-size" name="pageSize" defaultValue={query.pageSize}><option value="25">25 resultados</option><option value="50">50 resultados</option></select></div>
    </SearchFilterOptions>}>
    <input type="hidden" name="view" value={view} />
    <SearchFilterInput id="catalog-search" label="Buscar en catálogo" name="search" value={query.search} maxLength={128} placeholder={searchBy === "folio" ? "Ej. 0001" : searchBy === "filename" ? "Ej. constancia" : "Ej. 4frs5"} describedBy="catalog-search-help" />
    <div className="field"><label htmlFor="catalog-search-by">Buscar por</label><select id="catalog-search-by" name="searchBy" value={searchBy} onChange={event => setSearchBy(event.target.value as CatalogQuery["searchBy"])}><option value="alfanum">Alfanumérico</option><option value="folio">Folio</option><option value="filename">Nombre de archivo</option></select></div>
    <div className="field"><label htmlFor="catalog-state">Asociación</label><select id="catalog-state" name="state" defaultValue={query.state}><option value="all">Todas las asociaciones</option><option value="linked">Con imagen y registro</option><option value="missing">Registros sin imagen</option><option value="orphan">Imágenes sin registro</option></select></div>
  </SearchFilters>;
}
