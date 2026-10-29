"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { CheckCircle2, FileQuestion, ImageOff, Eye, ArrowUpRight } from "lucide-react";
import type { CatalogRow } from "@/features/records/catalog-query";
import { CatalogImage } from "./catalog-image";
import { RecordImageDetail } from "./record-image-detail";

const states = { linked: { label: "Relacionada", Icon: CheckCircle2 }, missing: { label: "Sin imagen", Icon: ImageOff }, orphan: { label: "Sin registro publicado", Icon: FileQuestion } };
export function ImageCatalog({ rows, validationId, active, view }: { rows: CatalogRow[]; validationId: string; active: boolean; view: "list" | "grid" }) {
  const [selected, setSelected] = useState<string | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const row = rows.find(row => row.key === selected);
  return <><div className={`image-catalog image-catalog-${view}`} role="list" aria-label="Catálogo de imágenes y registros">
    {view === "list" && <div className="catalog-list-heading" aria-hidden="true"><span>Documento / alfanumérico</span><span>Folio y tipo</span><span>Asociación</span><span>Acción</span></div>}
    {rows.map(row => { const { label, Icon } = states[row.state]; return <article className="catalog-item" role="listitem" key={row.key}>
      <div className="catalog-item-primary"><div className="catalog-thumbnail">{row.image ? <CatalogImage key={`${row.image.id}-${new Date(row.image.updatedAt).toISOString()}`} src={`/api/validations/${validationId}/images/${row.image.id}?thumbnail=1&v=${encodeURIComponent(new Date(row.image.updatedAt).toISOString())}`} width={row.image.width} height={row.image.height} alt={`Miniatura de ${row.alfanum}`} /> : <div className="catalog-no-image"><ImageOff size={24} aria-hidden="true" /><span>Sin imagen</span></div>}</div><div className="catalog-item-code"><strong>{row.alfanum}</strong><span>{row.image?.originalName ?? "Registro en la base publicada"}</span></div></div>
      <div className="catalog-item-record"><span className="catalog-mobile-label">Folio y tipo</span><strong>{row.folio ?? "Sin folio asociado"}</strong><span>{row.tipo ?? "—"}</span></div>
      <div className="catalog-item-state"><span className={`catalog-association catalog-association-${row.state}`}><Icon size={15} aria-hidden="true" />{label}</span></div>
      <div className="catalog-item-actions">{row.image ? <button className="button button-secondary" aria-label={`Ver imagen de ${row.alfanum}`} onClick={event => { trigger.current = event.currentTarget; setSelected(row.key); }}><Eye size={16} aria-hidden="true" />Ver imagen</button> : <Link className="text-link" href={`/validaciones/${validationId}/editar?tab=imagenes`}>Cargar imagen<ArrowUpRight size={15} aria-hidden="true" /></Link>}</div>
    </article>; })}
  </div>{row?.image && <RecordImageDetail key={row.key} row={row} validationId={validationId} active={active} onClose={() => setSelected(null)} restoreFocus={() => { if (trigger.current?.isConnected) trigger.current.focus(); }} />}</>;
}
