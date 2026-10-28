import Link from "next/link";
import { redirect } from "next/navigation";
import { Users } from "lucide-react";
import { requireActor } from "@/lib/auth";
import { listActiveTenantChoices, listUsers } from "@/features/identity/service";
import { userListQuerySchema, identityListUrl } from "@/features/identity/list-query";
import { ActionForm } from "@/components/action-form";
import { SearchFilters, SearchFilterInput, SearchFilterOptions } from "@/components/search-filters";
import { ListPagination } from "@/components/list-pagination";
import { ManagementTabs } from "@/components/management-tabs";
import { inviteUserAction, revokeSessionsAction, userStatusAction } from "@/app/actions";

export const metadata = { title: "Usuarios" };
const statusLabel = { ACTIVE: "Activo", INVITED: "Invitado", DISABLED: "Desactivado" };

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor(), admin = actor.role === "ADMIN";
  const raw = await searchParams;
  const parsed = userListQuerySchema.safeParse(raw);
  const query = parsed.success ? parsed.data : userListQuerySchema.parse({});
  const [result, activeTenants] = await Promise.all([listUsers(actor, query), admin ? listActiveTenantChoices(actor) : Promise.resolve([])]);
  const base = "/admin/usuarios";
  const filtered = Boolean(query.q || query.estado || query.rol || query.cuenta);
  const url = (page: number) => identityListUrl(base, query, page);
  if (parsed.success && result.page !== query.page) redirect(`${url(result.page)}${raw.tab === "invitar" ? "&tab=invitar" : ""}`);
  return <>
    <div className="page-heading"><div><h1>Usuarios</h1><p>{admin ? "Invita a los usuarios y controla su acceso a cada cuenta." : "Miembros con acceso a tu cuenta."}</p></div></div>
    <ManagementTabs listLabel="Usuarios" formLabel="Invitar usuario" formValue="invitar" list={<>
    {!parsed.success && <p className="feedback error" role="alert">Hay filtros inválidos. Mostramos los usuarios sin filtros; revisa los valores elegidos.</p>}
    <SearchFilters key={JSON.stringify(query)} action={base} active={filtered} clearHref={base} help={<p className="help" id="user-search-help">Busca por nombre o correo electrónico y combina la búsqueda con el estado del acceso.</p>}
      advanced={admin ? <SearchFilterOptions count={[query.rol, query.cuenta].filter(Boolean).length}>
        <div className="field"><label htmlFor="user-role">Filtrar por rol</label><select id="user-role" name="rol" defaultValue={query.rol}><option value="">Todos los roles</option><option value="ADMIN">Administrador</option><option value="CLIENT">Cliente</option></select></div>
        <div className="field"><label htmlFor="user-account">Buscar por cuenta</label><input id="user-account" name="cuenta" defaultValue={query.cuenta} maxLength={128} placeholder="Nombre de la cuenta…" /></div>
      </SearchFilterOptions> : undefined}>
      <SearchFilterInput id="user-search" label="Buscar usuarios" name="q" value={query.q} maxLength={128} placeholder="Nombre o correo electrónico…" describedBy="user-search-help" />
      <div className="field"><label htmlFor="user-status">Filtrar por estado</label><select id="user-status" name="estado" defaultValue={query.estado}><option value="">Todos los estados</option><option value="ACTIVE">Activos</option><option value="INVITED">Invitados</option><option value="DISABLED">Desactivados</option></select></div>
      <div className="field"><label htmlFor="user-page-size">Por página</label><select id="user-page-size" name="pageSize" defaultValue={query.pageSize}><option value="25">25 resultados</option><option value="50">50 resultados</option></select></div>
    </SearchFilters>
    {result.rows.length ? <div className="table-scroll" tabIndex={0} role="region" aria-label="Usuarios; tabla con desplazamiento horizontal"><table><caption className="sr-only">Usuarios y permisos de acceso</caption><thead><tr><th scope="col">Usuario</th>{admin && <th scope="col">Cuenta</th>}<th scope="col">Rol</th><th scope="col">Estado</th>{admin && <th scope="col">Acciones</th>}</tr></thead><tbody>{result.rows.map(user => <tr key={user.id}>
      <td><strong>{user.name}</strong><span className="cell-detail">{user.email}</span></td>{admin && <td>{user.tenant?.name ?? "Valweb"}</td>}<td>{user.role === "ADMIN" ? "Administrador" : "Cliente"}</td><td><span className={`status ${user.status === "ACTIVE" ? "active" : "inactive"}`}>{statusLabel[user.status]}</span></td>
      {admin && <td>{user.id === actor.id ? <span className="help">Tu usuario</span> : <div className="row-actions">{user.status === "INVITED" && user.tenantId && <ActionForm action={inviteUserAction} label="Reenviar invitación" compact><input type="hidden" name="name" value={user.name} /><input type="hidden" name="email" value={user.email} /><input type="hidden" name="tenantId" value={user.tenantId} /></ActionForm>}{user.status !== "INVITED" && <ActionForm action={userStatusAction} label={user.status === "DISABLED" ? "Activar" : "Desactivar"} compact confirmMessage={user.status === "ACTIVE" ? `¿Desactivar el acceso de ${user.name}? Se revocarán sus sesiones.` : undefined}><input type="hidden" name="id" value={user.id} /><input type="hidden" name="status" value={user.status === "DISABLED" ? "ACTIVE" : "DISABLED"} /></ActionForm>}{user.status === "ACTIVE" && <ActionForm action={revokeSessionsAction} label="Cerrar sesiones" compact confirmMessage={`¿Cerrar todas las sesiones de ${user.name}?`}><input type="hidden" name="id" value={user.id} /></ActionForm>}</div>}</td>}
    </tr>)}</tbody></table></div> : <div className="empty-state"><Users size={28} aria-hidden="true" /><h3>{filtered ? "No encontramos coincidencias" : "Aún no hay usuarios"}</h3><p>{filtered ? "Prueba otro nombre o correo, o limpia los filtros." : "Invita al primer usuario para darle acceso a una cuenta."}</p>{filtered && <Link href={base} className="button button-secondary">Ver todos los usuarios</Link>}</div>}
    {result.total > 0 && <ListPagination {...result} href={url} position="inferior" label="de usuarios" hideSinglePageControls />}
    </>} form={admin ? <section className="form-section" id="invitar-usuario"><div><h2>Datos del usuario</h2><p>Recibirá un enlace válido durante 48 horas para crear su contraseña.</p></div>{activeTenants.length ? <ActionForm action={inviteUserAction} label="Enviar invitación" pendingLabel="Enviando…"><div className="field"><label htmlFor="invite-name">Nombre</label><input id="invite-name" name="name" maxLength={120} autoComplete="name" required /></div><div className="field"><label htmlFor="invite-email">Correo electrónico</label><input id="invite-email" name="email" type="email" maxLength={254} autoComplete="email" required /></div><div className="field"><label htmlFor="invite-tenant">Cuenta</label><select id="invite-tenant" name="tenantId" required defaultValue=""><option value="" disabled>Selecciona una cuenta</option>{activeTenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div></ActionForm> : <p className="help">Primero crea o reactiva una cuenta en Clientes para invitar usuarios.</p>}</section> : undefined} />
  </>;
}
