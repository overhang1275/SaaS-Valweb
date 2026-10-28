import Link from "next/link";
import { requireActor } from "@/lib/auth";
import { listTenants } from "@/features/identity/service";
import { createValidationAction } from "@/features/validations/actions";
import { ValidationForm } from "@/components/validation-form";

export const metadata = { title: "Nueva validación" };

export default async function NewValidationPage() {
  const actor = await requireActor();
  const tenants = actor.role === "ADMIN" ? (await listTenants(actor)).filter(tenant => tenant.status === "ACTIVE").map(({ id, name }) => ({ id, name })) : undefined;
  return <>
    <Link href="/validaciones" className="back-link">Volver a validaciones</Link>
    <div className="page-heading"><div><h1>Nueva validación</h1><p>Guarda los datos para reservar el enlace. Después podrás importar los registros y cargar sus imágenes.</p></div></div>
    {tenants && tenants.length === 0 ? <div className="empty-state"><h2>Necesitas una cuenta activa</h2><p>Crea o reactiva una cuenta para asignarle esta validación.</p><Link className="button" href="/admin/clientes">Ir a clientes</Link></div> : <section className="surface create-validation-form"><ValidationForm action={createValidationAction} tenants={tenants} /></section>}
  </>;
}
