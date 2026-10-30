import Link from "next/link";
import { redirect } from "next/navigation";
import { Users } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { ConsultationValidationPicker } from "@/components/consultation-validation-picker";
import { requireActor } from "@/lib/auth";
import { listActiveTenantChoices, listConsultationUsers, listProtectedValidations } from "@/features/identity/service";
import { userListQuerySchema } from "@/features/identity/list-query";
import { inviteConsultationUserAction, consultationUserValidationsAction, userStatusAction } from "@/app/actions";

export const metadata = { title: "Usuarios de consulta" };
const statusLabel = { ACTIVE: "Activo", INVITED: "Invitado", DISABLED: "Desactivado" };

export default async function ConsultationUsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor();
  if (actor.role !== "ADMIN") redirect("/admin/usuarios");
  const parsed = userListQuerySchema.safeParse(await searchParams);
  const query = parsed.success ? parsed.data : userListQuerySchema.parse({});
  const [users, tenants, validations] = await Promise.all([
    listConsultationUsers(actor, query),
    listActiveTenantChoices(actor),
    listProtectedValidations(actor),
  ]);
  return <>
    <div className="page-heading"><div><h1>Usuarios de consulta</h1><p>Invita personas sin acceso al panel y limita cada cuenta a validaciones específicas.</p></div><Link className="button button-secondary" href="/admin/usuarios">Volver a usuarios</Link></div>
    <section className="form-section consultation-management"><div><h2>Invitar usuario</h2><p>Recibirá un enlace válido durante 48 horas para crear su contraseña. Necesita al menos una validación protegida.</p></div>
      {tenants.length ? <ActionForm action={inviteConsultationUserAction} label="Enviar invitación" pendingLabel="Enviando…">
        <div className="field"><label htmlFor="query-name">Nombre</label><input id="query-name" name="name" maxLength={120} autoComplete="name" required /></div>
        <div className="field"><label htmlFor="query-email">Correo electrónico</label><input id="query-email" name="email" type="email" maxLength={254} autoComplete="email" required /></div>
        <ConsultationValidationPicker tenants={tenants} validations={validations} />
      </ActionForm> : <p className="help">Primero crea o reactiva una cuenta para poder invitar personas.</p>}
    </section>
    <section className="form-section consultation-management"><div><h2>Accesos existentes</h2><p>Actualiza permisos o desactiva una cuenta de consulta.</p></div>
      {users.rows.length ? <div className="consultation-user-list">{users.rows.map(user => {
        const assignedIds = user.queryValidationAccesses.map(access => access.validation.id);
        const options = validations.filter(validation => validation.tenantId === user.tenantId);
        return <article className="surface consultation-user-card" key={user.id}>
          <div className="page-heading"><div><h3>{user.name}</h3><p>{user.email} · {user.tenant?.name ?? "Cuenta"}</p></div><span className={`status ${user.status === "ACTIVE" ? "active" : "inactive"}`}>{statusLabel[user.status]}</span></div>
          <ActionForm action={consultationUserValidationsAction} label="Guardar permisos" pendingLabel="Guardando…" compact><input type="hidden" name="id" value={user.id} /><div className="field"><label htmlFor={`grants-${user.id}`}>Validaciones autorizadas</label><select id={`grants-${user.id}`} name="validationIds" multiple size={Math.min(6, Math.max(3, options.length))} defaultValue={assignedIds}>{options.map(validation => <option key={validation.id} value={validation.id}>{validation.name}</option>)}</select><p className="help">Mantén Ctrl o ⌘ para seleccionar varias. Puedes quitar todos los permisos.</p></div></ActionForm>
          <div className="row-actions">{user.status === "INVITED" && <ActionForm action={inviteConsultationUserAction} label="Reenviar invitación" compact><input type="hidden" name="name" value={user.name} /><input type="hidden" name="email" value={user.email} /><input type="hidden" name="tenantId" value={user.tenantId!} />{assignedIds.map(id => <input key={id} type="hidden" name="validationIds" value={id} />)}</ActionForm>}{user.status !== "INVITED" && <ActionForm action={userStatusAction} label={user.status === "DISABLED" ? "Activar" : "Desactivar"} compact confirmMessage={user.status === "ACTIVE" ? `¿Desactivar el acceso de ${user.name}?` : undefined}><input type="hidden" name="id" value={user.id} /><input type="hidden" name="status" value={user.status === "DISABLED" ? "ACTIVE" : "DISABLED"} /></ActionForm>}</div>
        </article>;
      })}</div> : <div className="empty-state"><Users size={28} aria-hidden="true" /><h3>Aún no hay usuarios de consulta</h3><p>Cuando invites a alguien, aquí podrás revisar y cambiar las validaciones asignadas.</p></div>}
    </section>
  </>;
}
