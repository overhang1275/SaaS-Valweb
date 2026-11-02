import { ActionForm } from "@/components/action-form";
import { saveMailSettingsAction, sendConfiguredTestEmailAction } from "@/features/system/actions";
import type { getMailSettings } from "@/features/system/mail-settings";

export function MailSettings({ settings }: { settings: Awaited<ReturnType<typeof getMailSettings>> }) {
  return <section className="form-section system-mail-settings" aria-labelledby="mail-settings-title">
    <div><h2 id="mail-settings-title">Correo electrónico</h2><p>Configura el envío de invitaciones y recuperación de acceso para todas las cuentas de Valweb.</p><p>Los cambios se aplican a los próximos envíos, incluidos los que están en cola, sin reiniciar el procesador.</p></div>
    <div className="stack">
      <ActionForm action={saveMailSettingsAction} label="Guardar configuración">
        <div className="field"><label htmlFor="smtp-host">Servidor SMTP</label><input id="smtp-host" name="host" defaultValue={settings.host} required maxLength={253} autoComplete="off" spellCheck={false} placeholder="smtp.office365.com" /></div>
        <div className="field"><label htmlFor="smtp-port">Puerto SMTP</label><input id="smtp-port" name="port" type="number" inputMode="numeric" defaultValue={settings.port} required min={1} max={65535} aria-describedby="smtp-port-help" /><p className="help" id="smtp-port-help">465 usa TLS directo. En otros puertos se exige STARTTLS cuando hay autenticación.</p></div>
        <div className="field"><label htmlFor="smtp-from">Remitente</label><input id="smtp-from" name="from" defaultValue={settings.from} required maxLength={320} autoComplete="off" spellCheck={false} placeholder="Valweb <correo@dominio.com>" /></div>
        <div className="field"><label htmlFor="smtp-user">Usuario SMTP</label><input id="smtp-user" name="user" defaultValue={settings.user} maxLength={254} autoComplete="off" spellCheck={false} aria-describedby="smtp-user-help" /><p className="help" id="smtp-user-help">Déjalo vacío si tu servidor no requiere autenticación.</p></div>
        <div className="field"><label htmlFor="smtp-password">Contraseña SMTP</label><input id="smtp-password" name="password" type="password" maxLength={4096} autoComplete="new-password" aria-describedby="smtp-password-help" placeholder={settings.hasPassword ? "Conservar contraseña actual" : "Contraseña del servidor SMTP"} /><p className="help" id="smtp-password-help">{settings.hasPassword ? "Hay una contraseña configurada. Déjala vacía para conservarla si mantienes el servidor y el usuario." : "Introduce la contraseña si tu servidor requiere autenticación."} Al cambiar el servidor o el usuario, introduce la contraseña nueva.</p></div>
      </ActionForm>
      <div><h3>Probar el envío</h3><p className="help">Guarda los cambios antes de enviar la prueba. Se envía al correo del usuario SMTP o al remitente, con un máximo de una prueba por minuto.</p></div>
      <ActionForm action={sendConfiguredTestEmailAction} label="Enviar correo de prueba" pendingLabel="Enviando…" compact />
    </div>
  </section>;
}
