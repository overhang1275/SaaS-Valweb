import Link from "next/link";
import { Search, SlidersHorizontal } from "lucide-react";
import type { ReactNode } from "react";

export function SearchFilters({ action, active, clearHref, children, help, advanced }: {
  action: string; active: boolean; clearHref: string; children: ReactNode; help?: ReactNode; advanced?: ReactNode;
}) {
  return <form className="search-filters" method="GET" action={action}>
    <div className="search-filters-row">{children}<button className="button" type="submit">Buscar</button></div>
    {help}
    {advanced}
    {active && <div className="search-filters-applied"><span>Filtros aplicados</span><Link href={clearHref} className="text-link">Limpiar filtros</Link></div>}
  </form>;
}

export function SearchFilterInput({ id, label, name, value, placeholder, maxLength, describedBy }: {
  id: string; label: string; name: string; value: string; placeholder: string; maxLength: number; describedBy?: string;
}) {
  return <div className="field search-filters-search"><label htmlFor={id}>{label}</label><div className="search-filters-input"><Search size={18} aria-hidden="true" /><input id={id} name={name} type="search" defaultValue={value} maxLength={maxLength} autoComplete="off" placeholder={placeholder} aria-describedby={describedBy} /></div></div>;
}

export function SearchFilterOptions({ count, children, help }: { count: number; children: ReactNode; help?: ReactNode }) {
  return <details className="search-filter-options" open={count > 0 || undefined}><summary><SlidersHorizontal size={16} aria-hidden="true" />Más filtros{count > 0 && <span className="search-filter-count">{count}</span>}</summary><div className="search-secondary-filters">{children}</div>{help}</details>;
}
