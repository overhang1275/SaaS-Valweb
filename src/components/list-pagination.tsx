import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";

export function ListPagination({ page, pageSize, total, href, position, label, hideSinglePageControls = false }: {
  page: number; pageSize: number; total: number; href: (page: number) => string; position: "superior" | "inferior"; label: string; hideSinglePageControls?: boolean;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const number = (value: number) => value.toLocaleString("es-MX");
  const numbers = Array.from(new Set([1, page - 1, page, page + 1, pages].filter(value => value >= 1 && value <= pages))).sort((a, b) => a - b);
  const controls = !hideSinglePageControls || pages > 1;
  return <nav className="list-pagination" aria-label={`Paginación ${position} ${label}`}><p>{total ? `${number((page - 1) * pageSize + 1)}–${number(Math.min(page * pageSize, total))} de ${number(total)}` : "0 resultados"}{controls && <span>Página {number(page)} de {number(pages)}</span>}</p>{controls && <div>
    {page > 1 ? <Link href={href(page - 1)} className="button button-secondary" aria-label={`Página anterior (${position})`}><ArrowLeft size={16} aria-hidden="true" /><span>Anterior</span></Link> : <span className="button button-secondary is-disabled" aria-disabled="true"><ArrowLeft size={16} aria-hidden="true" /><span>Anterior</span></span>}
    <div className="list-page-numbers">{numbers.map((value, index) => <span key={value}>{index > 0 && value - numbers[index - 1] > 1 && <span className="list-page-gap">…</span>}<Link href={href(value)} aria-current={value === page ? "page" : undefined} aria-label={`Página ${value} (${position})`}>{value}</Link></span>)}</div>
    {page < pages ? <Link href={href(page + 1)} className="button button-secondary" aria-label={`Página siguiente (${position})`}><span>Siguiente</span><ArrowRight size={16} aria-hidden="true" /></Link> : <span className="button button-secondary is-disabled" aria-disabled="true"><span>Siguiente</span><ArrowRight size={16} aria-hidden="true" /></span>}
  </div>}</nav>;
}
