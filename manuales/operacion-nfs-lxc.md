# Reparar permisos NFS en un LXC sin privilegios

Caso resuelto el 2 de noviembre de 2026. Valweb no podía preparar carpetas de imágenes sobre NFS, aunque el montaje estaba disponible y el usuario pertenecía al grupo de imágenes. La corrección fue ejecutar Valweb con ese grupo como **primario**, reparar los directorios existentes desde PVE y reiniciar la web y el gestor de servicios del usuario.

El procedimiento corresponde a NFS montado en el host Proxmox y compartido al LXC mediante `mp0`. No requiere convertir el contenedor en privilegiado. Las rutas, IDs y número de contenedor siguientes son los del caso atendido; comprueba los tuyos antes de aplicar cambios.

## Síntomas y error original

El panel mostraba:

```text
No se pudo preparar la carpeta. Solicita revisar sus permisos y que no sea un enlace o archivo.
```

El instalador terminaba con:

```text
No se pudieron reparar los permisos NFS. Comprueba el GID de la raíz y que valweb sea propietario de las carpetas.
ERROR: No se pudieron reparar los permisos de las carpetas NFS existentes.
```

Al ejecutar la operación sin el mensaje genérico, se obtuvo:

```text
Error: EPERM: operation not permitted, fchown
    at childDirectory (.../src/features/images/filesystem.ts)
    at repairNfsImageFolders (.../src/features/images/permissions.ts)
```

`childDirectory` intenta asignar a la subcarpeta el grupo de su padre cuando no coinciden. El fallo observado ocurría al preparar `por_procesar`, no al consultar la base de datos ni al aplicar migraciones.

## Topología y mapeo de identidades

```text
NAS 192.168.200.1
  NFS → PVE 192.168.200.9:/mnt/bindmounts/valweb-nfs
  mp0 → LXC 134, 192.168.200.17:/mnt/valweb-nfs
```

Configuración relevante de `pct config 134`:

```text
mp0: /mnt/bindmounts/valweb-nfs,mp=/mnt/valweb-nfs
unprivileged: 1
```

Tanto `/proc/self/uid_map` como `/proc/self/gid_map`, dentro del LXC, mostraban `0 100000 65536`. En este mapeo se suma `100000` al ID del contenedor para obtener el ID del host.

| Identidad | Dentro del LXC | En PVE y en los atributos NFS observados |
| --- | ---: | ---: |
| Usuario `valweb` | UID 999 | UID 100999 |
| Grupo privado `valweb` | GID 990 | GID 100990 |
| Grupo `valweb-images` | GID 1500 | GID 101500 |

El nombre del grupo puede variar en la NAS; importa el ID efectivo. Un `65534` visto desde el LXC no basta para diagnosticar `root_squash`: comprueba el propietario también desde PVE. En este incidente hubo tanto IDs fuera del mapeo como directorios realmente pertenecientes a `65534` desde el host.

## Causa comprobada

Antes de la reparación, `valweb` tenía como grupo primario `990` y como secundario `1500`. La web también usaba el grupo privado como primario. Había entradas `por_procesar` con GID `100990` desde PVE, en vez de `101500`, y directorios heredados con propietario `65534`.

Se reprodujo la preparación con el mismo usuario y los mismos helpers de Valweb:

| Ejecución dentro del LXC | Resultado observado |
| --- | --- |
| UID 999, grupo primario 990, secundario 1500 | La carpeta nueva quedaba en modo `0770` tras solicitar `2770`; la subcarpeta fallaba con `EPERM fchown`. |
| UID 999, grupo primario 1500 | La carpeta y `por_procesar` conservaban `2770`; `procesadas` se creaba correctamente. |

Esta comparación confirmó la corrección para este montaje. No se determinó qué política interna de la NAS causaba ese tratamiento de los grupos secundarios. No debe extrapolarse como una limitación de todos los servidores NFS.

## Diagnóstico

Dentro del **LXC**, como root:

```bash
id valweb
cat /proc/self/uid_map
cat /proc/self/gid_map
findmnt -T /mnt/valweb-nfs -o TARGET,SOURCE,FSTYPE,OPTIONS
stat -c '%n uid=%u gid=%g permisos=%a' /mnt/valweb-nfs
systemctl show valweb -p User -p Group -p SupplementaryGroups
```

En **PVE**, como root, comprueba una carpeta concreta que falle. Sustituye el nombre por el mostrado en la validación:

```bash
pct config 134
carpeta='/mnt/bindmounts/valweb-nfs/UUID_CUENTA_UUID_VALIDACION'
stat -c '%n uid=%u gid=%g permisos=%a' \
  "$carpeta" "$carpeta/por_procesar" "$carpeta/procesadas"
```

Si falta una subcarpeta, `stat` lo indicará. No recorras `.snapshots`: durante el incidente `find` detectó un bucle en ese directorio de la NAS. El reparador de Valweb usa nombres procedentes de la base de datos y no lo recorre.

La raíz configurada en Ajustes generales es `/mnt/valweb-nfs`. La carpeta de una validación es `/mnt/valweb-nfs/<tenantUUID>_<validationUUID>`. No confundas ambas al diagnosticar: aplicar `dirname` a la raíz comprueba `/mnt`, que no es NFS, y produce un falso diagnóstico de montaje ausente.

## Reparar los directorios existentes desde PVE

Comprueba primero el mapeo y conserva un registro de propietarios y modos. Para **una validación afectada**, ejecuta en PVE:

```bash
bash <<'BASH'
set -euo pipefail
carpeta='/mnt/bindmounts/valweb-nfs/UUID_CUENTA_UUID_VALIDACION'
[[ -d "$carpeta" && ! -L "$carpeta" ]]
chown 100999:101500 "$carpeta"
chmod 2770 "$carpeta"
for nombre in por_procesar procesadas; do
  ruta="$carpeta/$nombre"
  if [[ -e "$ruta" || -L "$ruta" ]]; then
    [[ -d "$ruta" && ! -L "$ruta" ]]
    chown 100999:101500 "$ruta"
    if [[ "$nombre" == por_procesar ]]; then chmod 2770 "$ruta"; fi
  fi
done
BASH
```

El bloque no cambia imágenes ni aplica permisos recursivos. Conserva el modo de `procesadas`. Las subcarpetas faltantes se preparan posteriormente desde Valweb. En el caso atendido se corrigieron los directorios de cinco carpetas existentes, cuatro de ellas seleccionadas como destino NFS en la base de datos.

Si PVE rechaza `chown`, revisa las políticas de la exportación y realiza la corrección en la NAS usando su ruta local. No cambies los IDs del LXC para eludir el rechazo. La raíz del caso tenía UID `0` y GID `101500` desde PVE; no fue necesario cambiar su propietario.

## Configurar los grupos de los servicios

Primero espera a que no haya importaciones procesándose en el panel. El worker espera a terminar el lote activo al detenerse; no fuerces su cierre. El reinicio de la web interrumpe brevemente el servicio.

El siguiente bloque se ejecuta **dentro del LXC como root**. Conserva el grupo privado para seguir leyendo `/etc/valweb/.env` y usa un override de systemd que persiste aunque el instalador regenere la unidad principal.

```bash
bash <<'BASH'
set -euo pipefail
backup_dir=$(mktemp -d /var/backups/valweb/nfs-groups.XXXXXX)
cp -p /etc/passwd /etc/group "$backup_dir/"
override=/etc/systemd/system/valweb.service.d/nfs-group.conf
if [[ -f "$override" ]]; then cp -p "$override" "$backup_dir/"; fi
printf 'Respaldo: %s\n' "$backup_dir"

valweb_uid=$(id -u valweb)
valweb_home=$(getent passwd valweb | cut -d: -f6)
userctl(){
  runuser -u valweb -- env HOME="$valweb_home" \
    XDG_RUNTIME_DIR="/run/user/$valweb_uid" \
    DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$valweb_uid/bus" \
    systemctl --user "$@"
}
userctl stop valweb-imports
usermod --append --groups valweb --gid valweb-images valweb
install -d -m 755 /etc/systemd/system/valweb.service.d
cat > "$override" <<'UNIT'
[Service]
Group=valweb-images
SupplementaryGroups=valweb
UNIT
systemctl daemon-reload
systemctl restart "user@$valweb_uid.service"
userctl start valweb-imports
systemctl restart valweb
id valweb
systemctl is-active valweb
userctl is-active valweb-imports
BASH
```

Cambiar la cuenta no cambia los grupos de procesos ya iniciados. Es necesario reiniciar también `user@999.service`, el gestor que ejecuta el worker, para que este reciba el nuevo grupo primario.

## Verificar la reparación

Dentro del LXC, `id valweb` debe mostrar:

```text
uid=999(valweb) gid=1500(valweb-images) groups=1500(valweb-images),990(valweb)
```

Comprueba el proceso real de la web, además de la configuración declarada:

```bash
pid=$(systemctl show valweb -p MainPID --value)
sed -n '/^Uid:/p; /^Gid:/p; /^Groups:/p' "/proc/$pid/status"
```

Los cuatro valores de `Gid:` deben ser `1500`. Para el worker, obtén `MainPID` con `systemctl --user show valweb-imports -p MainPID --value` en el contexto de `userctl` del bloque anterior y revisa su `/proc/<PID>/status` del mismo modo.

Ejecuta el reparador existente desde la raíz del release:

```bash
cd /opt/valweb/current
runuser -u valweb -- node --import tsx scripts/repair-nfs-image-permissions.ts 1500
```

Este reparador corrige las carpetas existentes de las validaciones seleccionadas como NFS y sus entradas FTP; no prepara `procesadas` ni crea carpetas de validación ausentes. Después pulsa **Preparar carpeta** en una validación existente y en una nueva. Verifica que ambas puedan crear `por_procesar` y `procesadas`; comprobar solo carpetas antiguas no demuestra que la herencia esté corregida.

Resultados comprobados al cerrar el incidente:

- Reparador: `{ repaired: 4, missing: 0 }`.
- Preparación mediante los helpers de Valweb: correcta en las cuatro validaciones NFS configuradas.
- Carpeta temporal nueva: modo `2770`, grupo `1500` y entrada FTP con la misma herencia.
- Escritura y lectura de un archivo temporal: correctas; se retiraron el archivo y los directorios de prueba.
- Web y worker: activos, ambos con GID primario `1500` en sus procesos.
- `/login`: respuesta HTTP `200`.

No se modificaron archivos de imágenes existentes ni se comprobó el botón mediante navegador. El ajuste equivalente en `ops/valweb-install.sh` deja `valweb-images` como grupo primario y conserva `valweb` como secundario; debe publicarse para incorporarlo al instalador descargado de GitHub.

## Evitar diagnósticos y reparaciones incompletos

- `chmod 777` no concede permiso para cambiar propietario o grupo. No resuelve `EPERM fchown`.
- Añadir únicamente `valweb-images` como grupo secundario no resolvió este montaje.
- Corregir solo el propietario de la carpeta padre deja pendiente el grupo de `por_procesar` y la creación de carpetas nuevas.
- Un rechazo al usuario root del LXC no prueba que `valweb` carezca de acceso: son identidades distintas en PVE/NFS.
- El error del instalador puede restaurar el release anterior. Comprueba `readlink -f /opt/valweb/current` después de una actualización fallida. Omitir la reparación opcional permite continuar la actualización, pero no repara NFS.
- Los originales FTP deben seguir siendo legibles por el grupo de imágenes. Este procedimiento corrige directorios; no cambia las ACL ni los permisos de los archivos ya subidos.

Código relacionado: [preparación de carpetas](../src/features/images/locations.ts), [acceso y permisos del sistema de archivos](../src/features/images/filesystem.ts), [reparador compartido](../src/features/images/permissions.ts) e [instalador](../ops/valweb-install.sh).

## Importación detenida por espacio local

Durante una importación de imágenes con destino NFS apareció:

```text
No hay espacio suficiente para continuar. Libera espacio y reintenta sin subir de nuevo.
```

La comprobación está en `processImages` de [runner.ts](../src/features/imports/runner.ts): al guardar un avance verifica el espacio disponible en `importRoot()`, no solo en el destino de las imágenes. Si hay menos de **2 GiB** disponibles, detiene el lote y conserva el estado para reintentar. Una NAS con espacio libre no evita ese control del volumen local de trabajo.

En este caso el rootfs de 25 GiB tenía unos 1.7 GiB libres; `/opt/valweb/releases` ocupaba aproximadamente 20 GiB con 17 releases instalados. Las cargas de `/var/lib/valweb/imports` ocupaban solo 8 MiB y la NAS tenía unos 166 TiB disponibles. Los inodos locales tampoco estaban agotados.

Para distinguir los volúmenes, ejecuta dentro del LXC:

```bash
df -h / /var/lib/valweb/imports /mnt/valweb-nfs
df -i / /var/lib/valweb/imports
du -xhd1 /opt/valweb/releases /var/lib/valweb
readlink -f /opt/valweb/current
```

Se retiraron 14 releases antiguos después de comprobar que ningún proceso los utilizaba y que no contenían directorios de datos persistentes. Se conservaron el activo `5b62b6c`, el anterior `ec13386` y el de recuperación `adf5c36`. La limpieza no tocó imágenes, cargas, configuración ni respaldos y no requirió reiniciar servicios. El registro de los hashes retirados quedó en `/var/backups/valweb/release-cleanup-20261102T164211Z.json`; es un registro de limpieza, no una copia de esos releases.

Después quedaron **17.5 GiB disponibles**, con el disco al 25 % de uso. Se verificaron la web activa y `/login` con HTTP `200`. El siguiente paso es pulsar **Reintentar** en el lote fallido del panel, sin volver a subir los originales. No se reintentó el lote automáticamente durante la limpieza.

No reduzcas el umbral del importador ni borres sus archivos para eludir el control. La limpieza del servidor fue puntual. El instalador del repositorio incorpora ahora retención automática al instalar otra versión: después del respaldo y antes de copiar o compilar, conserva la instalada y la candidata y retira los releases anteriores. Si falla la candidata, mantiene disponible la instalada para la recuperación. No borra datos persistentes ni respaldos y rechaza limpiar releases con montajes o procesos activos. La opción de mantener la instalación actual no limpia releases. Este ajuste requiere publicar el instalador para que lo utilice el comando de descarga desde GitHub.

## Guardar imágenes directamente desde Windows por SMB

La NAS identificada por el operador es una Buffalo TS51220R1AC. El objetivo es que Windows genere los originales directamente en `\\192.168.200.1\01a18852_0a54c-743d\<tenantUUID>_<validationUUID>\por_procesar`, mientras Valweb accede a los mismos archivos por NFS. Después se inicia el procesamiento desde el panel; guardar por SMB no lo inicia automáticamente.

Windows podía abrir la raíz del recurso, pero no las carpetas de validaciones. El grupo local de la NAS es `g_valweb`, GID `1500`; las carpetas preparadas desde el LXC pertenecían al GID `101500` visto desde la NAS. La raíz admitía acceso con modo `2777`, mientras las validaciones tenían `2770`. Esa diferencia explicaba que se pudiera entrar al recurso pero no atravesar sus subcarpetas con el grupo `1500`.

Buffalo limita los grupos creados desde su interfaz a IDs entre `1000` y `1999`; no se puede crear allí un grupo `101500`. El nombre `g_valweb` es válido. La opción de permisos avanzados de subcarpetas documentada para la serie TS5020 requiere que solo esté habilitado SMB, por lo que no debe habilitarse desactivando el NFS que utiliza Valweb. Referencias oficiales: [creación de grupos](https://www.buffaloamericas.com/knowledge-base/KB1148) y [permisos de subcarpetas](https://www.buffaloamericas.com/knowledge-base/KB5142).

Se intentó asignar una ACL POSIX para el grupo `1500` mediante `setfacl` exclusivamente en una carpeta temporal del montaje NFSv4. El montaje respondió `Operation not supported`; se retiró la carpeta. Esto confirma que ese método no está disponible por el montaje actual, no que el sistema de archivos interno de la NAS carezca de toda forma de ACL.

También se probó una identidad numérica con grupo primario `1500`, distinta del propietario de la carpeta. La escritura fue rechazada con propietario de grupo `101500` y funcionó al cambiar solo el grupo de la carpeta temporal a `1500`, manteniendo modo `2770`. Se retiraron el archivo y la carpeta. Esta prueba reproduce el control de permisos por grupo a través de NFS; no sustituye una sesión SMB autenticada con la cuenta de Windows.

### Alternativa evaluada y no aplicada

**Estado: no autorizada y no aplicada.** El operador indicó que no se configure SMB en esta intervención. No se modificaron el mapeo del LXC ni los grupos de los archivos para esta alternativa, y no se reinició el contenedor. La reparación NFS anterior sigue activa con el desplazamiento de grupos original. Los detalles siguientes conservan la alternativa evaluada como referencia, no como una tarea pendiente.

El GID `1500` está libre en PVE. Para conservar el LXC sin privilegios y alinear solo el grupo de imágenes, el mapeo propuesto en `/etc/pve/lxc/134.conf` es:

```text
lxc.idmap: u 0 100000 65536
lxc.idmap: g 0 100000 1500
lxc.idmap: g 1500 1500 1
lxc.idmap: g 1501 101501 64035
```

Esto conserva todos los UID y el desplazamiento de los GID excepto el `1500`, que pasa directamente al host. Se comprobó que los rangos cubren los 65536 GID del contenedor sin solaparse. PVE necesitaría autorizar además `root:1500:1` en `/etc/subgid`, conservando la autorización existente `root:100000:65536`.

Antes de aplicar, hay que respaldar ambos archivos e inventariar los propietarios, grupos y modos de los archivos afectados. También hay numerosos archivos locales de Valweb con grupo de host `101500`: cambiar únicamente `lxc.idmap` los dejaría fuera del mapeo. La migración debe actualizar ese grupo a `1500` tanto en el rootfs como en los directorios y archivos NFS gestionados, preservando UID, modos y contenido y excluyendo `.snapshots` y enlaces externos.

La intervención requiere detener y arrancar el contenedor, después de esperar a que no haya importaciones procesándose. Al terminar deben verificarse el mapeo efectivo, los grupos de web y worker, la preparación de carpetas nuevas y existentes, la escritura desde Windows en `por_procesar` y la lectura de ese original por Valweb. El usuario de Windows debe pertenecer a `g_valweb` y tener acceso de lectura y escritura al recurso compartido en Buffalo. `procesadas` sigue siendo almacenamiento de Valweb; no es la bandeja para generar originales.
