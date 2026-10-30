"use client";

import { useId, useState } from "react";

type Tenant = { id: string; name: string };
type ValidationChoice = { id: string; name: string; tenantId: string; tenant: { name: string } };

export function ConsultationValidationPicker({ tenants, validations }: { tenants: Tenant[]; validations: ValidationChoice[] }) {
  const [tenantId, setTenantId] = useState("");
  const accountId = useId();
  const validationsId = useId();
  const options = validations.filter(validation => validation.tenantId === tenantId);
  return <>
    <div className="field"><label htmlFor={accountId}>Cuenta</label><select id={accountId} name="tenantId" required value={tenantId} onChange={event => setTenantId(event.target.value)}><option value="" disabled>Selecciona una cuenta</option>{tenants.map(tenant => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select></div>
    <div className="field"><label htmlFor={validationsId}>Validaciones protegidas</label><select id={validationsId} name="validationIds" multiple required size={Math.min(6, Math.max(3, options.length))} disabled={!tenantId}>{options.map(validation => <option key={validation.id} value={validation.id}>{validation.name}</option>)}</select><p className="help">Selecciona una o varias validaciones protegidas de esta cuenta.</p></div>
  </>;
}
