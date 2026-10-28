import Link from "next/link";
import { ClipboardCheck, Plus } from "lucide-react";
import { requireActor } from "@/lib/auth";
import { listValidations } from "@/features/validations/service";
import { publicValidationUrl } from "@/features/validations/public-url";
import { ValidationLink } from "@/components/validation-link";
import { SearchFilters, SearchFilterInput } from "@/components/search-filters";

export const metadata = { title: "Validaciones" };
const statusLabels = { DRAFT: "Borrador", ACTIVE: "Activa", INACTIVE: "Inactiva", DELETED: "Eliminada" };

export default async function ValidationsPage({ searchParams }: { searchParams: Promise<{ eliminada?: string; q?: string; estado?: string }> }) {
  const actor = await requireActor();
  const [allValidations, params] = await Promise.all([listValidations(actor), searchParams]);
  const query = (params.q || "").trim().slice(0, 120);
  const filter = ["ACTIVE", "INACTIVE", "DRAFT"].includes(params.estado || "") ? params.estado : "";
  const validations = allValidations.filter(row => (!query || `${row.name} ${row.title}`.toLowerCase().includes(query.toLowerCase())) && (!filter || row.status === filter));
  return <>
    <div className="page-heading"><div><h1>Validaciones</h1><p>Tus documentos, registros e imágenes, organizados en un solo lugar.</p></div><Link className="button" href="/validaciones/nueva"><Plus size={17} aria-hidden="true" />Nueva validación</Link></div>
    {params.eliminada === "1" && <p role="status" className="feedback success page-feedback">Validación eliminada.</p>}
    <SearchFilters key={`${query}:${filter}`} action="/validaciones" active={Boolean(query || filter)} clearHref="/validaciones" help={<p className="help" id="validation-search-help">Busca por nombre o título y combina la búsqueda con el estado de la validación.</p>}>
      <SearchFilterInput id="validation-search" label="Buscar validaciones" name="q" value={query} maxLength={120} placeholder="Buscar por nombre o título…" describedBy="validation-search-help" />
      <div className="field"><label htmlFor="validation-status">Filtrar por estado</label><select id="validation-status" name="estado" defaultValue={filter}><option value="">Todos los estados</option><option value="ACTIVE">Activas</option><option value="DRAFT">Borradores</option><option value="INACTIVE">Inactivas</option></select></div>
    </SearchFilters>
    <div className="section-line"><h2>{actor.role === "ADMIN" ? "Todas las validaciones" : "Validaciones de tu cuenta"}</h2><span>{validations.length} {validations.length === 1 ? "validación" : "validaciones"}</span></div>
    {validations.length > 0 && <p className="help mobile-table-hint">Desliza la tabla para ver enlaces y acciones.</p>}
    {validations.length ? <div className="table-scroll validations-table" tabIndex={0} role="region" aria-label="Validaciones; tabla con desplazamiento horizontal"><table>
      <caption className="sr-only">Validaciones y enlaces públicos reservados</caption>
      <thead><tr><th scope="col">Validación</th>{actor.role === "ADMIN" && <th scope="col">Cuenta</th>}<th scope="col">Estado</th><th scope="col">Enlace público</th><th scope="col">Acciones</th></tr></thead>
      <tbody>{validations.map(validation => <tr key={validation.id}>
        <td><strong className="validation-name">{validation.name}</strong><span className="cell-detail validation-name">{validation.title}</span></td>
        {actor.role === "ADMIN" && <td>{validation.tenant.name}</td>}
        <td><span className={`status ${validation.status === "ACTIVE" ? "active" : "inactive"}`}>{statusLabels[validation.status]}</span></td>
        <td><ValidationLink url={publicValidationUrl(validation.publicToken)} name={validation.name} /></td>
        <td><Link className="button button-secondary" href={`/validaciones/${validation.id}/editar`} aria-label={`Editar ${validation.name}`}>Editar</Link></td>
      </tr>)}</tbody>
    </table></div> : <div className="empty-state"><ClipboardCheck size={28} aria-hidden="true" /><h3>{allValidations.length ? "No encontramos coincidencias" : "Aún no hay validaciones"}</h3><p>{allValidations.length ? "Prueba con otro nombre o cambia los filtros." : "Crea una validación para personalizar sus textos y reservar su enlace."}</p><Link className="button button-secondary" href={allValidations.length ? "/validaciones" : "/validaciones/nueva"}>{allValidations.length ? "Ver todas las validaciones" : "Crear primera validación"}</Link></div>}
    <p className="help draft-note">El público consulta por alfanumérico. Activa cuando la base y las imágenes asociadas estén listas.</p>
  </>;
}
