# Configuración SMTP en Ajustes generales

Diseño aprobado: `docs/superpowers/specs/2026-11-02-smtp-settings-design.md`.
Ejecución: directa en la rama aislada `feat/smtp-settings`, con revisión independiente al terminar.

1. Añadir pruebas del servicio: autorización vigente, validación, contraseña cifrada, conservación y sustitución de credenciales, respaldo inicial del entorno y lectura actualizada.
2. Crear la tabla SMTP y su migración; reutilizar el cifrado existente conservando la compatibilidad de los tokens de acceso. Integrar lectura por envío en invitaciones, recuperaciones y prueba.
3. Añadir acción de guardado y formulario en Notificaciones reutilizando ActionForm, con contraseña vacía y mensajes accesibles. Revalidar la sesión también al probar correo.
4. Verificar con pruebas, tipos, lint y navegador en escritorio y móvil con SMTP local; documentar el uso y la migración. Obtener revisión independiente y resolver problemas importantes.

Verificación: las pruebas nuevas deben fallar antes de implementar y pasar después. La suite general conserva 27 fallos previos, cuya lista de referencia está en `/tmp/valweb-installer-full-tests.log`. No se envían correos reales ni se cambia la configuración del servidor de producción.

Riesgos a comprobar: nunca serializar credenciales, no sobrescribir contraseñas con campos vacíos, no reutilizar credenciales al cambiar servidor/usuario, rechazar sesiones revocadas y hacer efectivos los ajustes en el worker sin reiniciar.
