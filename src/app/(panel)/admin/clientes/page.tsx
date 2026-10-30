import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2 } from "lucide-react";
import { requireActor } from "@/lib/auth";
import { listTenantPage } from "@/features/identity/service";
import { tenantListQuerySchema, identityListUrl } from "@/features/identity/list-query";
import { ActionForm } from "@/components/action-form";
import { SearchFilters, SearchFilterInput } from "@/components/search-filters";
import { ListPagination } from "@/components/list-pagination";
import { ManagementTabs } from "@/components/management-tabs";
import { createTenantAction, tenantStatusAction, updateTenantNameAction } from "@/app/actions";
import { TenantNameForm } from "@/features/identity/tenant-name-form";

export const metadata = { title: "Clientes" };

export default async function ClientsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const parsed = tenantListQuerySchema.safeParse(raw);
  const query = parsed.success ? parsed.data : tenantListQuerySchema.parse({});
  const result = await listTenantPage(await requireActor(true), query);
  const base = "/admin/clientes", filtered = Boolean(query.q || query.estado);
  const url = (page: number) => identityListUrl(base, query, page);
  if (parsed.success && result.page !== query.page) redirect(`${url(result.page)}${raw.tab === "crear" ? "&tab=crear" : ""}`);
  const editId = typeof raw.editar === "string" ? raw.editar : "";
  const editingTenant = result.rows.find(tenant => tenant.id === editId);
  if (editId && !editingTenant) redirect(url(result.page));
  return <>
    <div className="page-heading"><div><h1>Clientes</h1><p>Administra las cuentas y el acceso de tus clientes.</p></div></div>
    <ManagementTabs listLabel="Clientes" formLabel={editingTenant ? "Editar cuenta" : "Crear cuenta"} formValue="crear" list={<>
    {!parsed.success && <p className="feedback error" role="alert">Hay filtros inválidos. Mostramos las cuentas sin filtros; revisa los valores elegidos.</p>}
    <SearchFilters key={JSON.stringify(query)} action={base} active={filtered} clearHref={base} help={<p className="help" id="client-search-help">Busca por nombre de cuenta y combina la búsqueda con su estado.</p>}>
      <SearchFilterInput id="client-search" label="Buscar clientes" name="q" value={query.q} maxLength={128} placeholder="Nombre de la cuenta…" describedBy="client-search-help" />
      <div className="field"><label htmlFor="client-status">Filtrar por estado</label><select id="client-status" name="estado" defaultValue={query.estado}><option value="">Todos los estados</option><option value="ACTIVE">Activas</option><option value="SUSPENDED">Suspendidas</option></select></div>
      <div className="field"><label htmlFor="client-page-size">Por página</label><select id="client-page-size" name="pageSize" defaultValue={query.pageSize}><option value="25">25 resultados</option><option value="50">50 resultados</option></select></div>
    </SearchFilters>
    {result.rows.length ? <><p className="help mobile-table-hint clients-table-hint">Desliza la tabla horizontalmente para ver el estado y las acciones.</p><div className="table-scroll clients-table-scroll" tabIndex={0} role="region" aria-label="Clientes; tabla con desplazamiento horizontal"><table className="clients-table"><caption className="sr-only">Cuentas de clientes y su estado</caption><thead><tr><th scope="col">Cuenta</th><th scope="col">Usuarios</th><th scope="col">Estado</th><th scope="col">Acciones</th></tr></thead><tbody>{result.rows.map(tenant => <tr key={tenant.id}><td className="primary-cell">{tenant.name}</td><td className="numeric">{tenant._count.users}</td><td><span className={`status ${tenant.status === "ACTIVE" ? "active" : "inactive"}`}>{tenant.status === "ACTIVE" ? "Activa" : "Suspendida"}</span></td><td><div className="row-actions"><Link className="button button-secondary" aria-label={`Editar ${tenant.name}`} href={`${url(query.page)}&editar=${encodeURIComponent(tenant.id)}&tab=crear`}>Editar</Link><ActionForm action={tenantStatusAction} label={tenant.status === "ACTIVE" ? "Suspender" : "Reactivar"} compact confirmMessage={tenant.status === "ACTIVE" ? `¿Suspender ${tenant.name}? Sus usuarios perderán el acceso y sus sesiones se revocarán.` : undefined}><input type="hidden" name="id" value={tenant.id} /><input type="hidden" name="status" value={tenant.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE"} /></ActionForm></div></td></tr>)}</tbody></table></div></> : <div className="empty-state"><Building2 size={28} aria-hidden="true" /><h3>{filtered ? "No encontramos coincidencias" : "Aún no hay cuentas"}</h3><p>{filtered ? "Prueba otro nombre o limpia los filtros." : "Crea la primera cuenta y después invita a sus usuarios."}</p>{filtered && <Link href={base} className="button button-secondary">Ver todas las cuentas</Link>}</div>}
    {result.total > 0 && <ListPagination {...result} href={url} position="inferior" label="de clientes" hideSinglePageControls />}
    </>} form={<section className="form-section" id="crear-cuenta"><div><h2>{editingTenant ? "Editar cuenta" : "Datos de la cuenta"}</h2><p>{editingTenant ? "Actualiza el nombre visible de esta cuenta." : "Cada cuenta mantiene separados sus usuarios y datos."}</p></div>{editingTenant ? <TenantNameForm action={updateTenantNameAction} id={editingTenant.id} name={editingTenant.name} cancelHref={url(query.page)} /> : <ActionForm action={createTenantAction} label="Crear cuenta"><div className="field"><label htmlFor="tenant-name">Nombre de la cuenta</label><input id="tenant-name" name="name" maxLength={120} required placeholder="Nombre del cliente" /></div></ActionForm>}</section>} />
  </>;
}
