# Valweb

SaaS multiusuario de validaciones web de **Computer Forms**. Incluye identidad, administración de cuentas y gestión de validaciones: crear, editar, eliminar, personalizar textos, reservar un enlace UUID, administrar imágenes privadas y activar/desactivar con requisitos comprobados. Incluye carga masiva CSV/ZIP en segundo plano y consulta pública por alfanumérico con campos configurables e imagen por registro.

## Manuales de uso

- [Guía comercial del enlace público](manuales/ventas-enlace-publico.md): cómo presentar la consulta y qué verá la persona destinataria.
- [Guía del panel de administración](manuales/panel-administracion-admin.md): cuentas, usuarios, validaciones, cargas, publicación y estadísticas.

## Requisitos

- Node.js 22.12 o posterior compatible con Prisma 7 y npm.
- PostgreSQL 18, una base de desarrollo y otra desechable llamada `valweb_test` para pruebas.
- Un buzón autorizado para enviar correos de invitación y recuperación.
- Para pruebas locales de archivos: Python3 y el ejecutable `zip`.
- `curl` y acceso a Internet para descargar el instalador del LXC.

## Instalación en LXC (beta)

El instalador configura Valweb dentro de un contenedor LXC existente; no crea contenedores. Requiere Debian 12/13 o Ubuntu 24.04 con systemd, acceso a Internet y permisos de root. Instala la versión actual del script desde la rama principal:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/overhang1275/SaaS-Valweb/refs/heads/main/ops/valweb-install.sh)"
```

El instalador crea el grupo local `valweb-images` con GID `1500` por defecto y agrega el servicio `valweb`. Consulta **Permisos de NAS para FTP** antes de recibir imágenes por FTP.

El asistente permite actualizar paquetes, elegir una release o un commit, configurar la aplicación y respaldar datos antes de actualizar. Los archivos se guardan en `/opt/valweb`, la configuración en `/etc/valweb/.env` y los datos en `/var/lib/valweb`. La beta necesita un proxy TLS externo para servir HTTPS. Conserva los respaldos: las migraciones de base de datos no se revierten automáticamente.

## Desarrollo

1. Ejecuta `npm ci`.
2. Copia `.env.example` a `.env` y configura `DATABASE_URL`.
3. Genera `NEXTAUTH_SECRET` con `openssl rand -hex 48`.
4. Ejecuta `npm run db:generate` y `npm run db:migrate`.
5. Define `ADMIN_EMAIL`, `ADMIN_NAME` y `ADMIN_PASSWORD` (12–128 caracteres), y ejecuta `npm run db:seed`. No hay contraseña predeterminada. Repetir el seed conserva la contraseña existente.
6. Ejecuta `npm run dev` y abre http://localhost:3000/login.
7. En otra terminal ejecuta `npm run worker:imports`. El servidor web recibe archivos; el worker procesa CSV e imágenes y envía invitaciones y enlaces de recuperación pendientes. Ambos deben usar la misma base y los mismos volúmenes privados.

En este workspace se dejó un administrador local `admin@valweb.local`. Su contraseña aleatoria se encuentra únicamente en `.env`, campo `ADMIN_PASSWORD`. Ese archivo está excluido de Git y tiene permisos restrictivos. La instancia PostgreSQL local escucha en `127.0.0.1:55432`; desde el 28 de octubre sus datos están en `var/postgres`, excluido de Git, para conservarlos al limpiar `/tmp`. La base temporal anterior ya no estaba disponible: se creó una base nueva y el administrador mediante el seed; esto no recupera los registros anteriores. Para un entorno permanente utiliza PostgreSQL con almacenamiento persistente y copias de seguridad.

Para reiniciar esta instancia local desde la raíz del proyecto, ejecuta `pg_ctl -D var/postgres -l var/postgres.log -o '-h 127.0.0.1 -p 55432 -k /tmp' start` y después `npm run dev`. El acceso habitual es `http://localhost:3000/login`; el puerto3001 corresponde al entorno de pruebas y utiliza cuentas independientes.

Mantén también `npm run worker:imports` en otra terminal para procesar CSV e imágenes y enviar correos de acceso del entorno habitual. Sin ese proceso, las cargas y los correos permanecen en cola; al iniciarlo recupera los pendientes. `worker:test` procesa únicamente la base y el SMTP local de pruebas.

### Ajustes generales y procesador supervisado

Los administradores disponen de `/admin/ajustes`: conexión a la base, estado del servicio de importaciones, espacio libre del volumen de cargas y conteos de lotes en cola, en proceso, por revisar y con errores. La pantalla actualiza la comprobación cada10segundos mientras está visible. Permite iniciar/reiniciar el procesador con confirmación, registro de auditoría y un límite global de una solicitud por minuto.

En este equipo el procesador se instaló como servicio de usuario de systemd, con arranque al iniciar la sesión y recuperación automática tras un fallo. Procesa importaciones y correos pendientes con reintentos. No ejecutes simultáneamente `worker:imports` manualmente si el servicio está activo. La unidad está en `ops/valweb-imports.service`; para instalarla en otro servidor Linux, ajusta `WorkingDirectory` y la ruta de Node antes de habilitarla:

```sh
systemctl --user enable --now /ruta/absoluta/SaaS-Valweb/ops/valweb-imports.service
systemctl --user status valweb-imports.service
journalctl --user -u valweb-imports.service
```

El servidor web y el servicio deben ejecutarse con el mismo usuario y configuración de base/volúmenes. El worker deja de tomar lotes y espera a terminar el activo antes de cerrar; `TimeoutStopSec=infinity` evita cortar una importación por tiempo durante el reinicio. Si un lote queda bloqueado indefinidamente, el reinicio también esperará: el operador debe revisar el journal. Si systemd no está disponible o la unidad no está instalada, la pantalla lo indica y deshabilita el control. La instancia aislada de pruebas nunca controla el servicio habitual.

El botón controla el procesador de importaciones. La base de datos y el servidor web se administran desde el servidor: si alguno está caído y el panel no puede autenticar, se necesita recuperación externa. Los archivos físicos de PostgreSQL siguen en `var/postgres`, pero el proceso PostgreSQL debe arrancarse después de reiniciar el equipo.

## Correo: Microsoft 365 por defecto

Valores preparados:

```dotenv
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=
```

Configura los secretos directamente en `.env` o en el gestor de secretos del despliegue; no los publiques en chat, Git o logs. `SMTP_USER` es el buzón de envío y `SMTP_FROM` puede usar el mismo buzón. Un remitente diferente necesita permisos Send As.

Para Office 365 se utiliza STARTTLS en el puerto 587, con verificación del certificado y TLS 1.2 o posterior. No utilices el puerto 465 para este servicio. El buzón debe tener habilitado SMTP AUTH y su política debe permitir el método de autenticación configurado. El login de Valweb es independiente del acceso al buzón.

La integración actual usa usuario/contraseña SMTP. Microsoft anunció que a finales de diciembre de 2026 la autenticación básica quedará deshabilitada por defecto para tenants existentes; antes del despliegue debe comprobarse la política del tenant y planificar OAuth si corresponde. No se desactivan automáticamente las políticas de seguridad de Microsoft 365. Referencias: [configuración de Microsoft 365](https://learn.microsoft.com/en-us/exchange/mail-flow-best-practices/how-to-set-up-a-multifunction-device-or-application-to-send-email-using-microsoft-365-or-office-365), [SMTP AUTH](https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/authenticated-client-smtp-submission), [calendario actualizado](https://techcommunity.microsoft.com/blog/exchange/updated-exchange-online-smtp-auth-basic-authentication-deprecation-timeline/4489835).

`NEXTAUTH_URL` determina el origen de los enlaces. En producción debe ser el dominio HTTPS real. Sin credenciales válidas no se envían correos: la invitación muestra un error y no deja un usuario incompleto; recuperación responde siempre de forma genérica para no revelar cuentas existentes. Los fallos de recuperación se registran sin direcciones ni tokens.

## Permisos y revocación

- `ADMIN`: cuentas y usuarios; creación, carga y publicación de validaciones; configuración de almacenamiento, resultados y estado.
- `CLIENT`: consulta sus validaciones y estadísticas, y edita textos y descripción. No carga registros o imágenes ni cambia la publicación.
- `CONSULTATION_ONLY`: inicia sesión únicamente desde un enlace público protegido que le haya asignado el administrador; no accede al panel.
- El administrador invita a usuarios de consulta desde **Usuarios → Administrar accesos de consulta** y puede conceder o retirar validaciones protegidas. Los clientes solo pueden ver los usuarios y permisos de consulta de su cuenta.
- No hay registro público ni creación de administradores desde formularios.
- Cada operación protegida consulta estado, rol y cuenta actuales. Modificar IDs o campos de formularios no permite cruzar cuentas.
- Desactivar un usuario, suspender su cuenta o cambiar su contraseña revoca sus JWT anteriores. Reactivar el acceso exige iniciar sesión otra vez.
- Invitaciones: 48 horas; recuperación: una hora. Tokens aleatorios, hash SHA-256 y consumo único atómico.
- Contraseñas Argon2id; cookies de sesión protegidas por NextAuth y HTTPS en producción.
- Server Actions verifican origen; NextAuth protege sus operaciones con CSRF. Los GET no cambian datos.

## Gestión de validaciones

En el panel, abre **Validaciones**. Cada cliente ve únicamente las validaciones de su cuenta; el administrador ve todas y selecciona la cuenta propietaria al crear. La cuenta no se transfiere desde edición. El administrador prepara y publica registros e imágenes; el cliente puede editar textos y descripción y consultar estadísticas.

Puedes configurar nombre interno, título público, instrucciones y mensajes de éxito/error. Al crear se reserva un enlace `/v/<uuid-v4>` con UUID público aleatorio distinto del identificador administrativo. Editar conserva el enlace. Eliminar requiere confirmación, oculta el registro y conserva su token para que nunca se reutilice.

Cada validación comienza en borrador. El modo predeterminado es **una imagen por alfanumérico**, con carga masiva ZIP. Las validaciones anteriores mantienen su modo de imagen compartida; puedes cambiarlo en «Resultado público». La migración conserva sus imágenes y registros existentes.

En la edición, abre **Apariencia** para seleccionar qué campos mostrar: folio, alfanumérico, tipo de documento, otros e imagen. La búsqueda siempre usa el alfanumérico; no utiliza el folio mostrado. Ejemplo: `4frs5` encuentra el registro `0001,4frs5,Diploma,Otro` y la imagen `4frs5.png`. El folio se guarda como texto y conserva sus ceros iniciales. Los códigos permiten letras ASCII y números, hasta128 caracteres, sin distinguir mayúsculas. No se permiten espacios internos ni guiones.

La consulta `/v/<uuid>` tiene un campo. Un código válido devuelve solo los campos habilitados y su imagen; un código inexistente devuelve el error configurado. Las validaciones inactivas, eliminadas o de cuentas suspendidas responden404 sin revelar sus textos ni imágenes. Las consultas válidas y no encontradas incrementan contadores diarios en PostgreSQL. En **Validaciones → Editar → Resumen → Estadísticas** se muestran registros publicados, consultas, encontrados y no encontrados. «Actualizar estadísticas» vuelve a consultar los datos. Los registros corresponden solo a la base publicada actual; las consultas acumulan toda la historia de esa validación y no son visitantes únicos. Los formatos inválidos y solicitudes bloqueadas se excluyen. Los campos ocultos se omiten del JSON del servidor. Las imágenes públicas se dibujan en un visor canvas con zoom de100% a500%, arrastre, ajuste inicial, teclado y pinch táctil. El navegador las recibe por POST mediante una autorización cifrada de cinco minutos vinculada a una cookie HttpOnly; el servidor comprueba de nuevo estado, versión y navegador antes de entregar los bytes. No se devuelve una URL de imagen en el resultado.

Activar exige una cuenta activa y registros reales en una base publicada. Si la imagen está habilitada, requiere la compartida o una imagen por cada alfanumérico del dataset. La edición indica cuántas faltan. Guardar la configuración de resultados o publicar otra base desactiva una validación activa para revisarla. Eliminar una imagen de un resultado activo exige confirmar su desactivación.

## Carga masiva CSV e imágenes

1. En **Editar → Registros → Carga masiva**, sube un CSV UTF-8 con encabezados.
2. El worker lee los encabezados con DuckDB; el panel pide asignar `folio`, `alfanum`, y opcionalmente `tipo` y `otro` (también reconoce el encabezado `tro`).
3. Selecciona reemplazar la base o agregar/actualizar por alfanumérico. Se detectan filas vacías, datos inválidos y duplicados sin distinción de mayúsculas; el reporte incluye muestras de errores. Una base con errores no se publica.
4. Revisa el resumen y publica. El dataset previo se conserva hasta ese momento. Dos importaciones concurrentes no pueden sobrescribir silenciosamente una base publicada después de su análisis.
5. En **Editar → Imágenes**, selecciona el destino local o NFS. Una instalación nueva deja LOCAL configurado en `/var/lib/valweb/images`; el administrador puede cambiar esa ruta y definir NFS desde **Ajustes generales**. La carpeta por validación se llama `<tenantUUID>_<validationUUID>` y contiene `por_procesar/` para originales FTP y `procesadas/` para imágenes administradas.
6. Para cargas web, usa «Imágenes ZIP o imagen individual» y carga un ZIP con `4frs5.png`, `ABC123.jpg`, etc. Admite JPG/JPEG/PNG/WebP estáticos. El nombre sin extensión determina el alfanumérico; también admite carpetas interiores seguras. Los duplicados en el mismo ZIP se rechazan.
7. Para recibir imágenes por FTP, deposítalas directamente en `por_procesar/` y termina la carga antes de pulsar **Procesar**. Se captura una copia privada para que los reintentos no dependan de FTP. Las imágenes nuevas se publican automáticamente; los reemplazos se muestran para confirmación. Solo después de publicar se elimina cada original cuya identidad y huella sigan iguales. Errores, cancelaciones y reemplazos sin confirmar se conservan.
8. Activa cuando base e imágenes estén completas. El catálogo permite buscar por prefijo, ver50 imágenes por página y eliminarlas.

El panel muestra recepción en porcentaje, estado, archivos procesados, historial reciente y reporte descargable. El reporte indica la causa por archivo: formato real distinto de la extensión, límite de bytes/píxeles, animación, duplicados o fallo del decodificador. Las advertencias de JPEG se rechazan en modo estricto y se muestran con explicación en español y detalle técnico; por ejemplo, un byte sobrante antes del marcador JPEG 0xd9. No se reparan archivos automáticamente. Puedes cerrar la pantalla mientras se procesa, cancelar o reintentar desde el archivo recibido. Los reintentos de imágenes reutilizan las ya procesadas de ese trabajo. La recepción HTTP no es reanudable: si la conexión se corta antes de recibir el archivo completo hay que volver a enviarlo.

El worker usa una cola persistente pg-boss en PostgreSQL, un lote simultáneo por proceso y bloqueo de trabajo para impedir dos procesamientos del mismo lote. Al arrancar recupera trabajos interrumpidos, y reencola periódicamente los recibidos que sigan pendientes. Para este MVP ejecuta **una sola réplica del worker**; escalar workers requiere revisar límites globales de disco/CPU y cuotas por cliente.

Límites iniciales:

- CSV:100MiB, hasta5millones de filas,100 columnas y64KiB por línea. DuckDB usa256MB,2 hilos y hasta4GB temporales; el límite no equivale al consumo total del proceso nativo. El análisis tiene un límite de30minutos. La inserción usa PostgreSQL COPY y SQL por conjuntos, sin insertar una fila por petición.
- Imágenes:50,000 por lote y catálogo de validación,10MiB y20millones de píxeles por archivo. Se comprueba contenido real y se recodifica a WebP sin metadatos. Un error de espacio conserva los avances para reintentar.
- ZIP:50GiB recibido y100GiB descomprimido por defecto, configurables con `MAX_ZIP_BYTES` y `MAX_EXPANDED_BYTES`. Se rechazan rutas inseguras, enlaces simbólicos, cifrado, demasiadas entradas y compresión desproporcionada. Nunca se extraen rutas del ZIP al disco.
- Recepción:dos cargas simultáneas por proceso, diez por usuario/hora, límite de una hora y comprobación de espacio. Reserva disco para el original, imágenes normalizadas, staging y bases antiguas;50,000 imágenes de2MiB son aproximadamente98GiB solo de originales sin compresión.

`IMPORT_STORAGE_DIR` usa `var/imports`; debe ser un volumen privado persistente compartido con el worker. `IMAGE_STORAGE_DIR` conserva la raíz histórica, mientras la ruta local predeterminada y las rutas LOCAL/NFS nuevas se persisten en la base. Web y worker deben ver los mismos montajes con permisos de lectura/escritura; en Linux/LXC, NFS debe estar montado por el host o el sistema operativo, no por la aplicación. El instalador no monta NFS ni cambia propietarios recursivamente dentro de destinos administrados. Para FTP, el grupo `valweb-images` debe tener el mismo GID en la NAS y en el LXC; concede al grupo acceso heredable en la raíz compartida y acceso de escritura/listado en `por_procesar/`. Configura el servidor FTP para crear archivos legibles por el worker. Reserva espacio para originales, captura y WebP normalizadas.

## Permisos de NAS para FTP

Las carpetas de validación las crea Valweb dentro de la raíz de imágenes, por ejemplo `/mnt/valweb-nfs/<tenantUUID>_<validationUUID>/por_procesar/`. El usuario del servicio y las cuentas FTP deben compartir un GID numérico para que puedan colaborar sobre NFS.

1. En la NAS, crea el grupo `valweb-images` con GID `1500` si está libre y agrega las cuentas FTP autorizadas, por ejemplo `tecnologias.informacion` e `informacion.variable`.
2. Asigna ese grupo a la raíz exportada, por ejemplo `/nfs/valweb`, y habilita herencia de permisos/ACL para subcarpetas y archivos. El grupo necesita atravesar y listar directorios; `por_procesar/` necesita escritura para FTP. Los archivos que suba FTP deben quedar legibles por el grupo para que Valweb pueda procesarlos.
3. El instalador crea `valweb-images` en el LXC con ese GID y agrega `valweb`; confirma con `id valweb` que aparezca `1500(valweb-images)`. Comprueba también que la raíz montada pertenezca al grupo `1500` con `stat -c '%g' /mnt/valweb-nfs`. Si `1500` está ocupado en alguno de los equipos, elige un ID libre entre `1000` y `1999` y configura el mismo en NAS y LXC. Para cambiar el predeterminado al ejecutar el instalador:

   ```bash
   VALWEB_IMAGE_GID=1501 bash -c "$(curl -fsSL https://raw.githubusercontent.com/overhang1275/SaaS-Valweb/refs/heads/main/ops/valweb-install.sh)"
   ```
4. En Valweb, configura como ruta NFS la ruta de montaje del LXC, por ejemplo `/mnt/valweb-nfs`. Cada validación tendrá su propia carpeta y su bandeja `por_procesar/`.
5. Durante una actualización, el instalador ofrece **Reparar permisos del grupo FTP en carpetas NFS de validaciones existentes**. Responde `s` para cambiar grupo y permisos solo en las carpetas de validación y `por_procesar/`; la raíz debe tener el GID configurado. `procesadas/` y los archivos existentes no se modifican. Si archivos FTP antiguos tampoco son legibles por Valweb, aplica desde la NAS la ACL de lectura del grupo a esos archivos.

Usa permisos de grupo (directorios `rwx`, archivos FTP legibles por el grupo) y evita `777`. El instalador no cambia la configuración ni las ACL de la NAS.

## Almacenamiento privado de imágenes

`IMAGE_STORAGE_DIR` permite elegir un volumen privado persistente; por defecto se utiliza `var/assets`. No puede estar dentro de `public/`. El directorio está excluido de Git; debe incluirse en copias de seguridad junto con PostgreSQL. Para el servidor de pruebas se utiliza `var/test-assets`, separado del almacenamiento principal.

La vista previa pasa por `GET /api/validations/:id/image`, exige sesión vigente y propiedad o rol administrador, y usa `private, no-store`. POST y DELETE validan además el origen contra `NEXTAUTH_URL`, con límite por usuario. La recepción limita bytes reales aunque no haya Content-Length; existe límite de tiempo, píxeles y dos cargas simultáneas por proceso. La normalización usa [Sharp](https://sharp.pixelplumbing.com/api-output/).

El nuevo archivo se guarda antes de cambiar la referencia en una transacción. El anterior se retira después del commit. Si falla la confirmación de commit, se comprueba la referencia antes de limpiar para no borrar una imagen que sí quedó guardada. Un fallo de limpieza deja un archivo privado huérfano, sin URL pública.

Ejecuta `npm run images:cleanup` desde una tarea programada. Elimina solo WebP huérfanas antiguas dentro de `procesadas/` y capturas de trabajos terminales con más de24horas; conserva archivos publicados, `por_procesar/` y capturas de trabajos reintentables o pendientes de revisión. El respaldo del instalador incluye la base y las rutas locales. Verifica que las raíces NFS requeridas estén disponibles, pero no las recorre ni las copia: configura snapshots o respaldos en la NAS para evitar incluir directorios internos como `.snapshots` y depender de permisos remotos desde el LXC. Para recuperación, conserva ambos respaldos: el del instalador y el de la NAS.

## Interfaz de Computer Forms

La identidad usa el logo oficial local y los colores corporativos navy/rojo/amarillo; texto y controles respetan contraste. El panel organiza cada validación en **Resumen**, **Registros e imágenes**, **Apariencia** y **Ajustes**, con URL enlazable `?tab=`, navegación por teclado y conservación de formularios/archivos al cambiar de pestaña. Guardar configuración/textos y publicar conserva el comportamiento y permisos existentes. El estado de publicación y enlace siguen disponibles en contexto; en móvil se prioriza el contenido seleccionado.

El dashboard muestra validaciones y conteos reales. Las listas permiten buscar nombre/título y filtrar estado. La navegación móvil usa un panel lateral accesible; las confirmaciones importantes se muestran en un diálogo con Cancelar/Confirmar y cierre por Escape. Los detalles técnicos e historial son desplegables. Hay ayudas contextuales, skeletons por tipo de ruta, estados de consulta/imagen y reintentos. Las animaciones respetan `prefers-reduced-motion`.

Especificación y ejemplos: `DESIGN.md`.

## Verificación

```sh
npm run typecheck
npm run lint
npm run build -- --webpack
npm test
```

Configura `TEST_DATABASE_URL` apuntando exclusivamente a `/valweb_test` y aplica las migraciones a esa base antes de `npm test`. Los tests de integración eliminan sus registros de prueba; nunca deben usar una base con datos reales. Se incluye un control del nombre de base para impedir ejecuciones accidentales contra desarrollo o producción.

Para el recorrido completo de navegador:

1. Ejecuta primero las pruebas de integración y espera a que terminen.
2. En una terminal, ejecuta `npm run dev:test`. Usa la base desechable, puerto 3001 y compilación `.next-test` separada.
3. En otra terminal, ejecuta `npm run test:e2e`. Si Chromium no está instalado, instálalo con `npx playwright install chromium`. Puedes indicar una instalación existente mediante `CHROME_PATH`.

El recorrido levanta un SMTP local en `127.0.0.1:2525`, captura los mensajes en memoria y no envía correos externos. Comprueba login, creación de cuentas, invitación, activación, recuperación, aislamiento, desactivación y suspensión. Crea datos con identificadores aleatorios y los elimina al terminar. No ejecutes integración y navegador simultáneamente sobre `valweb_test`.

Con `npm run dev:test` activo, ejecuta también `npm run test:e2e:validations` para comprobar CRUD, textos, UUID, carga/reemplazo/borrado de imágenes, formatos falsos, límites, acceso privado, CSRF, aislamiento, estados y confirmaciones. La activación positiva utiliza un dataset y folio reales creados exclusivamente en valweb_test; no se agrega información ficticia al entorno principal. Cubre390/768/1280/1440px y desplazamiento con teclado de la tabla móvil. No necesita enviar correos y elimina únicamente sus propios fixtures. Ejecuta los recorridos de navegador de uno en uno.

`npm run test:e2e:filters`, contra `start:test`, verifica búsqueda/paginación de Clientes y Usuarios con 61 cuentas y 60 miembros, filtros combinados, acceso por rol, tabs/URL/historial/teclado, borradores conservados al alternar y ausencia de buscador en Invitar usuario. `test:e2e:catalog` incluye la búsqueda estándar de Validaciones y los filtros avanzados del catálogo. Ejecuta estos recorridos de uno en uno y después de integración; permiten `CHROME_PATH` para utilizar Chromium instalado.

## Producción y límites de esta fase

Ejecuta migraciones antes de `npm run build` y `npm start`. Configura HTTPS, PostgreSQL persistente, secretos y SMTP. El volumen de datos en `/tmp` de esta sesión es de desarrollo y no es almacenamiento de producción.

Los límites iniciales de login se aplican por correo y globalmente; los formularios administrativos también tienen límite. Antes de publicar detrás de un proxy debe añadirse el límite por IP de ese proxy. Invitaciones y recuperaciones se guardan en un outbox de PostgreSQL y el worker reintenta fallos con espera progresiva; la dirección de recuperación se encola igual exista o no una cuenta. El envío es al menos una vez: una caída justo después de que SMTP acepte un correo puede provocar un duplicado al reintentar.

Clientes y Usuarios buscan/filtran en PostgreSQL y muestran 25 o 50 filas por página, con total real y navegación que conserva los filtros. Clientes busca nombre/estado; Usuarios busca nombre o correo, estado, rol y cuenta, manteniendo el aislamiento del cliente. Listado y Crear cuenta/Invitar usuario son pestañas separadas; la invitación no tiene buscador y conserva un selector nativo con los nombres de las cuentas activas. Validaciones conserva su listado completo en esta fase. Todas las búsquedas administrativas reutilizan el estándar del catálogo, documentado en DESIGN.md. No se implementan facturación, OAuth para correo, almacenamiento S3/R2 ni registro público. Para CSV/ZIP grandes se requiere un servidor Node persistente y worker independiente; los límites habituales de plataformas serverless no sirven para esta recepción. Configura el proxy para permitir el tamaño, streaming sin buffering y los tiempos de carga previstos. La recepción no implementa multipart reanudable.

La consulta pública limita300 solicitudes/minuto globales y30 por validación/IP. Sin `TRUST_PROXY=true` utiliza un bucket compartido por validación. Actívalo únicamente detrás de un proxy confiable que reemplace `X-Forwarded-For`; bloquear acceso directo al servidor evita encabezados falsificados. Las rutas de importación verifican sesión, propiedad y origen, y limitan el cuerpo de comandos. Nunca expongas los volúmenes privados como directorios estáticos.

El recorrido `npm run test:e2e:bulk` requiere `npm run dev:test` y `npm run worker:test`. Comprueba una carga completa real de1,000 imágenes, CSV, mapeo, publicación, activación, consulta por alfanumérico, ocultamiento de campos y catálogo paginado. Ejecuta las pruebas de navegador de una en una y después de integración. La suite también procesa50,000 filas CSV y revisa un manifiesto ZIP de50,000 nombres; eso **no es un benchmark de decodificación de50,000 imágenes reales**.

## Verificación del rediseño en producción local

Después de `npm test`, puedes usar una compilación aislada de pruebas:

```sh
npm run build:test
npm run start:test
# En otra terminal, para el recorrido de archivos:
npm run worker:test
# Ejecutar uno por uno:
npm run test:e2e
npm run test:e2e:validations
npm run test:e2e:bulk
npm run test:e2e:premium
```

`start:test` usa3001; detén `dev:test` antes de arrancarlo. Los comandos build/start de prueba fuerzan la base desechable y volúmenes separados. `test:e2e:premium` comprueba tabs/URL/historial/teclado, conservación de entradas y archivo, ayuda, confirmación cancelada, navegación móvil, cuatro anchos, reduced-motion y skeleton/errores/reintentos de consulta e imagen. Los fallos de red son interceptados solo por el navegador de pruebas. Los screenshots quedan en `output/playwright/premium-*`.

Se usa producción local para aislar una excepción de medición de rendimiento que Next/React puede emitir en desarrollo al resolver redirects/notFound; no se filtran esos errores para aprobar los tests.

Verificación final del rediseño:52/52 pruebas, TypeScript, ESLint y build de producción aprobados. Los cuatro recorridos de navegador (identidad, validaciones, carga1000 imágenes y premium) pasan contra producción local de prueba. No se probaron Safari ni lectores de pantalla físicos; los límites de medición/entorno se documentan en el informe.

## Visor de imagen de la consulta

El visor ofrece **Acercar**, **Alejar** y **Ajustar imagen**. Arrastra después de ampliar, usa dos dedos en pantalla táctil, Ctrl+rueda o las teclas +/−, flechas y0. El desplazamiento queda limitado al marco; el lienzo no crece con el zoom ni solicita otra copia por cada movimiento. Se libera el bitmap al cambiar de consulta. Las imágenes administrativas y las cargas conservan sus rutas y comportamiento.

Entrega: `POST /api/public/images` con JSON `{ "grant": "…" }`, cookie `valweb_image_viewer` HttpOnly/SameSite=Strict (Secure con HTTPS), origen configurado y autorización vigente ligada al hash de esa cookie. Respuesta no-store/nosniff/CORP same-origin. GET no entrega imágenes. El grant opaco viene de una consulta válida; no incluye rutas legibles ni el valor de cookie. Cuerpo limitado y rate limiting por navegador/global. Una autorización copiada a otro navegador no basta para obtener la imagen.

**Esto controla el acceso, no evita toda copia.** Un navegador autorizado recibe los píxeles y puede capturarlos o extraerlos con sus herramientas. Canvas y bloquear el menú contextual dentro del visor no son DRM; no se afirma que reproduzca el mecanismo interno de Instagram. La revocación bloquea nuevas entregas, no borra datos ya recibidos por un visitante. Los resultados abiertos antes del cambio deben consultar el código otra vez para obtener el grant nuevo.

## PWA de cada enlace público

Cada `/v/<uuid>` activo puede instalarse como acceso independiente: manifest propio, nombre del título público, iconos de Computer Forms y apertura standalone directamente en esa validación. En navegadores compatibles aparece **Instalar consulta** cuando el navegador habilita el diálogo; la ayuda indica el menú de instalación y Compartir/Añadir a pantalla de inicio en iPhone/iPad.

La PWA necesita HTTPS fuera de localhost. El service worker solo controla `/v/` y las navegaciones de consultas públicas. No usa CacheStorage ni guarda resultados, códigos, grants o imágenes para consulta offline. Sin conexión muestra una página genérica de recuperación; siempre se necesita red para validar códigos y obtener documentos. No controla el login ni el panel. Desactivar la validación impide obtener su manifest y nuevas consultas, aunque el acceso directo instalado pueda seguir en el dispositivo.

Verifica con `npm run test:e2e:pwa` contra `start:test`, después de integración y de uno en uno con los demás E2E. Se comprueban identidades por enlace, metadatos/iconos, scope, elegibilidad Chromium, offline sin resultados/caché, recuperación y revocación. No se afirma instalación física iOS/Android desde el navegador headless.
