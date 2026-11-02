# Configuración del correo desde Ajustes generales

## Objetivo

Permitir que un administrador cambie la configuración global SMTP desde Ajustes generales → Notificaciones. Afecta invitaciones, recuperación de acceso y correos de prueba de todas las cuentas.

## Alternativas

- **Base de datos con contraseña cifrada, recomendada:** web y worker leen los valores en cada envío, sin reinicio. Requiere una tabla y migración. La configuración del entorno sigue funcionando hasta guardar ajustes desde el panel.
- **Modificar el archivo del servidor:** requiere dar permisos sobre secretos de despliegue y reiniciar web y worker. Se descarta como propuesta por esos permisos y por interrumpir servicios para cambiar el correo.

El usuario aprobó la alternativa de base de datos cifrada y aplicación sin reinicio.

## Interfaz y comportamiento

Reutilizar la sección Notificaciones y ActionForm. Añadir servidor SMTP, puerto, remitente, usuario y contraseña; conservar el botón de prueba existente. Mostrar mensajes de validación, guardado y envío, con controles utilizables en móvil y mediante teclado.

No se muestra ni se devuelve al navegador la contraseña guardada. Dejarla vacía conserva la actual únicamente si no cambian servidor y usuario; al cambiar esas credenciales se exige una contraseña nueva. Un relay sin usuario puede trabajar sin contraseña.

Los cambios guardados se aplican al siguiente envío. Las invitaciones y recuperaciones ya en cola utilizan la configuración efectiva cuando el worker las procese. La prueba usa los ajustes guardados y mantiene el límite actual de un envío por minuto.

## Seguridad y compatibilidad

- Autorizar lectura y escritura solo a administradores vigentes, revalidando la sesión en el servidor.
- Validar servidor, puerto, remitente y tamaños; rechazar inyección de encabezados.
- Cifrar la contraseña con AES GCM y el secreto estable de la aplicación, reutilizando el patrón existente sin alterar el cifrado de los tokens pendientes.
- Registrar la modificación sin credenciales en la auditoría.
- Conservar la configuración del entorno como respaldo inicial; no modificar archivos del despliegue.
- Mantener TLS directo en el puerto 465 y exigir STARTTLS para autenticación en otros puertos.

No incluye OAuth, múltiples proveedores simultáneos ni configuración por cliente.

## Verificación

Pruebas de autorización, validación, cifrado, conservación de contraseña, configuración inicial del entorno y aplicación de cambios en los envíos. Verificación del formulario en navegador, en escritorio y móvil, con correo de prueba capturado localmente y sin enviar mensajes reales.
