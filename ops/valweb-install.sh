#!/usr/bin/env bash
# Valweb installer and updater for an existing Debian/Ubuntu LXC.
set -Eeuo pipefail
umask 077

readonly REPO=https://github.com/overhang1275/SaaS-Valweb.git
readonly API=https://api.github.com/repos/overhang1275/SaaS-Valweb
APP=/opt/valweb
RELEASES=$APP/releases
readonly CONFIG=/etc/valweb/.env
readonly DATA=/var/lib/valweb
readonly BACKUPS=/var/backups/valweb
readonly SERVICE=valweb
readonly WORKER=valweb-imports
readonly PORT_DEFAULT=3000
TMP=""
OLD_LINK=""
SWITCHED=0
SERVICES_STOPPED=0
URL_CHANGED=0
VALWEB_HOME=""
VALWEB_GROUP=""
say(){ printf '\n\033[1;36mValweb\033[0m %s\n' "$*"; }
recover(){
  set +e
  if [[ -n $OLD_LINK ]]; then
    (( SWITCHED )) && ln -sfn "$OLD_LINK" "$APP/current"
    if (( SERVICES_STOPPED )); then systemctl restart "$SERVICE"; userctl restart "$WORKER"; fi
  elif (( SWITCHED )); then
    systemctl stop "$SERVICE"; userctl stop "$WORKER"
  fi
}
die(){ printf '\nERROR: %s\n' "$*" >&2; recover; exit 1; }
ask(){ local prompt=$1 default=$2 value; read -r -p "$prompt [$default]: " value; printf '%s' "${value:-$default}"; }
yesno(){ local prompt=$1 answer; read -r -p "$prompt [s/N]: " answer; [[ $answer =~ ^[sS]$ ]]; }
envq(){ local value=$1; [[ $value != *$'\n'* && $value != *$'\r'* ]] || die 'No se admiten saltos de línea en variables de entorno.'; value=${value//\\/\\\\}; value=${value//\"/\\\"}; printf '"%s"' "$value"; }
valid_url(){ [[ $1 =~ ^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?/?$ ]]; }
getenv(){ sed -n "s/^$1=//p" "$CONFIG" | tail -n1 | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"; }
cleanup(){ [[ -z $TMP ]] || rm -rf -- "$TMP"; }
trap cleanup EXIT
userctl(){ local uid; uid=$(id -u valweb); runuser -u valweb -- env HOME="$VALWEB_HOME" XDG_CONFIG_HOME="$VALWEB_HOME/.config" XDG_RUNTIME_DIR="/run/user/$uid" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$uid/bus" systemctl --user "$@"; }
own_data_dirs(){
  [[ ! -L $DATA && ! -L $DATA/images && ! -L $DATA/imports ]] || die 'Los directorios persistentes de Valweb no pueden ser enlaces simbólicos.'
  [[ ! -d $DATA ]] || mountpoint -q "$DATA" || chown "valweb:$VALWEB_GROUP" "$DATA"
  for data_dir in "$DATA/images" "$DATA/imports"; do
    [[ ! -d $data_dir ]] || mountpoint -q "$data_dir" || chown "valweb:$VALWEB_GROUP" "$data_dir"
  done
}
run_as_valweb(){
  local uid gid
  uid=$(id -u valweb); gid=$(id -g valweb)
  (cd "$RELEASE" && HOME="$VALWEB_HOME" node --input-type=commonjs -e 'const fs=require("node:fs"),{spawnSync}=require("node:child_process"); const [config,uid,gid,cwd,command,...args]=process.argv.slice(1); let values; try{values=require("dotenv").parse(fs.readFileSync(config,"utf8"))}catch{console.error("No se pudo leer la configuración de Valweb");process.exit(78)} const env={...process.env,...values,HOME:process.env.HOME,USER:"valweb",LOGNAME:"valweb"}; if(!env.DATABASE_URL?.trim()){console.error("DATABASE_URL está vacía en /etc/valweb/.env; corrígela antes de continuar");process.exit(78)} const result=spawnSync(command,args,{cwd,uid:Number(uid),gid:Number(gid),env,stdio:"inherit"}); if(result.error){console.error("No se pudo iniciar el comando de Valweb");process.exit(1)} process.exit(result.status??1)' "$CONFIG" "$uid" "$gid" "$RELEASE" "$@")
}
on_error(){ local code=$?; trap - ERR; recover; if [[ -n $OLD_LINK ]]; then printf '\nERROR: Falló la línea %s (código %s). Se restauró el release anterior; el esquema de base de datos no se revierte automáticamente. Respaldo: %s\n' "$1" "$code" "$BACKUPS" >&2; else printf '\nERROR: Falló la línea %s (código %s). Se detuvieron los servicios de Valweb; conserva la base de datos y revisa el respaldo: %s\n' "$1" "$code" "$BACKUPS" >&2; fi; exit "$code"; }
trap 'on_error "$LINENO"' ERR

usage(){ cat <<'HELP'
Valweb: instalación, actualización y reparación en un LXC existente.

  bash valweb-install.sh          Asistente interactivo
  bash valweb-install.sh --help   Mostrar esta ayuda
  bash valweb-install.sh --check  Validar shell y dependencias locales, sin cambios

El script no crea contenedores. Requiere Debian 12/13 o Ubuntu 24.04, LXC,
root, systemd y acceso a Internet. La aplicación se instala en /opt/valweb,
configuración en /etc/valweb y datos persistentes en /var/lib/valweb.
HELP
}

check(){
  [[ -n ${BASH_VERSION:-} ]] || die 'Ejecuta con Bash.'
  [[ $EUID -eq 0 ]] || die 'Ejecuta como root dentro del LXC.'
  [[ -r /etc/os-release ]] || die 'No se identifica la distribución.'
  . /etc/os-release
  [[ ${ID:-} == debian || ${ID:-} == ubuntu ]] || die 'Solo Debian o Ubuntu.'
  case "${ID}:${VERSION_ID}" in debian:12|debian:13|ubuntu:24.04) ;; *) die "Distribución no soportada: ${PRETTY_NAME:-desconocida}.";; esac
  command -v systemd-detect-virt >/dev/null || die 'Falta systemd-detect-virt.'
  local virt; virt=$(systemd-detect-virt --container 2>/dev/null || true)
  [[ $virt == lxc || $virt == lxc-libvirt ]] || die 'No se detectó un LXC. No se modificó el sistema.'
  [[ $(ps -p 1 -o comm=) == systemd ]] || die 'PID 1 debe ser systemd dentro del LXC.'
  [[ -d /run/systemd/system ]] || die 'systemd no está activo.'
}

[[ ${1:-} == --help || ${1:-} == -h ]] && { usage; exit 0; }
[[ ${1:-} == --check ]] && { bash -n "$0" && [[ $(envq 'a b#$x"') == '"a b#$x\""' ]] && valid_url 'https://val-web.computerform.com.mx' && ! valid_url 'https://example.test/path' && printf 'Sintaxis y validaciones correctas.\n'; exit; }
[[ $# -eq 0 ]] || { usage >&2; exit 2; }
check

if [[ -L /opt/valweb/current ]]; then APP=/opt/valweb; else APP=$(ask 'Directorio de instalación' '/opt/valweb'); fi
[[ $APP =~ ^/(opt|srv)/[A-Za-z0-9_./-]+$ && $APP != */../* && $APP != */.. ]] || die 'Usa una ruta absoluta simple dentro de /opt o /srv.'
RELEASES=$APP/releases

say "Sistema: ${PRETTY_NAME}. Instalación existente: $([[ -L $APP/current ]] && echo sí || echo no)."
if yesno '¿Actualizar paquetes del sistema operativo?'; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get upgrade -y
fi
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git jq nginx openssl postgresql postgresql-client build-essential python3 xz-utils
systemctl enable --now postgresql
TMP=$(mktemp -d /tmp/valweb-manager.XXXXXX)
chmod 700 "$TMP"

# Node 24 LTS from the NodeSource Debian/Ubuntu repository; the app requires a current Node runtime.
if ! command -v node >/dev/null || ! node -e 'process.exitCode = Number(process.versions.node.split(".")[0]) < 24 ? 1 : 0'; then
  curl -fsSL https://deb.nodesource.com/setup_24.x -o "$TMP/nodesource.sh"
  bash "$TMP/nodesource.sh"
  apt-get install -y nodejs
fi
node -e 'if(Number(process.versions.node.split(".")[0])<24)process.exit(1)' || die 'Se necesita Node.js 24 LTS o superior.'

mkdir -p "$RELEASES" "$DATA/images" "$DATA/imports" "$BACKUPS" /etc/valweb
chmod 700 "$BACKUPS"
if ! id valweb >/dev/null 2>&1; then useradd --system --user-group --home-dir "$APP" --create-home --shell /usr/sbin/nologin valweb; fi
VALWEB_HOME=$(getent passwd valweb | cut -d: -f6)
[[ -n $VALWEB_HOME && -d $VALWEB_HOME ]] || die 'No existe el directorio personal de la cuenta valweb.'
VALWEB_GROUP=$(id -gn valweb)
chown root:"$VALWEB_GROUP" /etc/valweb
chmod 750 /etc/valweb
chown -R "valweb:$VALWEB_GROUP" "$APP"
own_data_dirs
loginctl enable-linger valweb
systemctl start "user@$(id -u valweb).service"
[[ -S "/run/user/$(id -u valweb)/bus" ]] || die 'systemd no creó el bus de usuario para el worker.'

INSTALLED=""
if [[ -L $APP/current ]]; then INSTALLED=$(runuser -u valweb -- git -C "$APP/current" rev-parse HEAD 2>/dev/null || true); fi
[[ -n $INSTALLED ]] || INSTALLED=ninguno
if yesno '¿Buscar versiones y actualizaciones de Valweb en GitHub?'; then SEARCH=1; else SEARCH=0; fi
[[ $SEARCH == 1 ]] || { [[ $INSTALLED != ninguno ]] || die 'No hay una instalación para conservar.'; TARGET=$INSTALLED; MODE=keep; }

if [[ $SEARCH == 1 ]]; then
  curl -fsSL "$API" -o "$TMP/repo.json"
  BRANCH=$(jq -er '.default_branch' "$TMP/repo.json")
  curl -fsSL "$API/releases?per_page=20" -o "$TMP/releases.json"
  curl -fsSL "$API/commits?sha=$BRANCH&per_page=10" -o "$TMP/commits.json"
  STABLE_COUNT=$(jq '[.[] | select(.draft|not) | select(.prerelease|not)] | length' "$TMP/releases.json")
  printf '\nRama principal: %s\nCommit instalado: %s\nReleases estables publicadas: %s\n' "$BRANCH" "${INSTALLED:0:12}" "$STABLE_COUNT"
  jq -r '.[] | "  \(.sha[0:10])  \(.commit.author.date)  \(.commit.message | split("\\n")[0])"' "$TMP/commits.json"
  (( STABLE_COUNT > 0 )) || printf 'Este repositorio no tiene releases estables publicadas; las betas y commits recientes pueden ser inestables.\n'
  printf '\n[1] Última release estable (recomendada)\n[2] Último commit de %s (desarrollo)\n[3] Elegir entre los 10 commits recientes (desarrollo)\n[4] Introducir hash de commit\n' "$BRANCH"
  [[ $INSTALLED == ninguno ]] || printf '[5] Mantener instalación actual\n'
  read -r -p 'Selecciona versión: ' choice
  case $choice in
    1) (( STABLE_COUNT > 0 )) || die 'No hay release estable. Selecciona explícitamente un commit de desarrollo.'; TARGET=$(jq -er 'map(select(.draft|not) | select(.prerelease|not))[0].tag_name' "$TMP/releases.json"); MODE=stable ;;
    2) TARGET=$(jq -er '.[0].sha' "$TMP/commits.json"); MODE=development ;;
    3) select_commit(){ local n; read -r -p 'Número (1-10): ' n; [[ $n =~ ^([1-9]|10)$ ]] || die 'Número inválido.'; jq -er ".[${n}-1].sha" "$TMP/commits.json"; }; TARGET=$(select_commit); MODE=development ;;
    4) read -r -p 'Hash completo o abreviado: ' TARGET; [[ $TARGET =~ ^[0-9a-fA-F]{7,40}$ ]] || die 'Hash inválido.'; MODE=manual ;;
    5) [[ $INSTALLED != ninguno ]] || die 'No existe versión instalada.'; TARGET=$INSTALLED; MODE=keep ;;
    *) die 'Opción inválida.' ;;
  esac
fi

if [[ $MODE != keep ]]; then
  git clone --filter=blob:none --no-checkout "$REPO" "$TMP/source"
  git -C "$TMP/source" fetch --tags origin
  git -C "$TMP/source" cat-file -e "$TARGET^{commit}" 2>/dev/null || git -C "$TMP/source" fetch origin "$TARGET"
  TARGET=$(git -C "$TMP/source" rev-parse "$TARGET^{commit}")
  git -C "$TMP/source" checkout --detach "$TARGET"
  [[ $(jq -r '.full_name' "$TMP/repo.json") == overhang1275/SaaS-Valweb ]] || die 'El repositorio remoto no coincide con el oficial.'
  [[ -f $TMP/source/package-lock.json && -f $TMP/source/prisma/schema.prisma ]] || die 'El commit no contiene una aplicación Valweb compatible.'
  if [[ $MODE == manual ]] && ! git -C "$TMP/source" branch -r --contains "$TARGET" | grep -q . && ! git -C "$TMP/source" tag --contains "$TARGET" | grep -q .; then die 'El commit no pertenece a una rama o tag publicado del repositorio.'; fi
  printf '\nInstalado: %s\nSeleccionado: %s (%s)\n' "${INSTALLED:0:12}" "${TARGET:0:12}" "$MODE"
  git -C "$TMP/source" log -1 --format='Fecha: %cI%nDescripción: %s' "$TARGET"
  if [[ $INSTALLED != ninguno ]] && runuser -u valweb -- git -C "$APP/current" cat-file -e "$INSTALLED^{commit}" 2>/dev/null; then runuser -u valweb -- git -C "$APP/current" log --oneline "$INSTALLED..$TARGET" | head -20; fi
  yesno '¿Continuar con esta versión?' || exit 0
fi

if [[ $INSTALLED != ninguno ]]; then
  [[ -f $CONFIG ]] || die 'Hay un release existente pero falta /etc/valweb/.env. Recupéralo antes de actualizar.'
  RELEASE="$APP/current"
  OLD_LINK=$(readlink -f "$APP/current")
  say 'Deteniendo servicios y creando un respaldo coherente.'
  STAMP=$(date -u +%Y%m%dT%H%M%SZ)
  if ! grep -q '^IMAGE_STORAGE_DIR=' "$CONFIG" && [[ -d $APP/current/var/assets ]] && [[ -z $(find "$DATA/images" -mindepth 1 -print -quit) ]]; then cp -a "$APP/current/var/assets/." "$DATA/images/"; fi
  if ! grep -q '^IMPORT_STORAGE_DIR=' "$CONFIG" && [[ -d $APP/current/var/imports ]] && [[ -z $(find "$DATA/imports" -mindepth 1 -print -quit) ]]; then cp -a "$APP/current/var/imports/." "$DATA/imports/"; fi
  own_data_dirs
  systemctl stop "$SERVICE" 2>/dev/null || true
  userctl stop "$WORKER" 2>/dev/null || true
  SERVICES_STOPPED=1
  (cd "$APP/current" && node --input-type=commonjs -e 'require("dotenv").config({path:process.argv[1],override:true}); const {spawnSync}=require("node:child_process"); const u=new URL(process.env.DATABASE_URL); const env={...process.env,PGHOST:u.hostname,PGPORT:u.port||"5432",PGUSER:decodeURIComponent(u.username),PGPASSWORD:decodeURIComponent(u.password),PGDATABASE:decodeURIComponent(u.pathname.slice(1)),PGSSLMODE:u.searchParams.get("sslmode")||"disable"}; const r=spawnSync("pg_dump",["--format=custom","--no-owner","--no-acl","--file",process.argv[2],"--dbname",env.PGDATABASE],{env,stdio:"inherit"}); process.exit(r.status??1)' "$CONFIG" "$BACKUPS/$STAMP.dump")
  if [[ -f $APP/current/scripts/image-backup-paths.ts ]]; then
    IMAGE_PATHS_JSON=$(run_as_valweb node --import tsx scripts/image-backup-paths.ts) || die 'No se pudieron verificar los destinos de imágenes para el respaldo.'
  elif [[ -f $TMP/source/scripts/image-backup-paths-legacy.mjs ]]; then
    cp "$TMP/source/scripts/image-backup-paths-legacy.mjs" "$TMP/image-backup-paths-legacy.mjs"
    chmod 711 "$TMP"
    chmod 644 "$TMP/image-backup-paths-legacy.mjs"
    IMAGE_PATHS_JSON=$(run_as_valweb env NODE_PATH="$APP/current/node_modules" node "$TMP/image-backup-paths-legacy.mjs" "$CONFIG") || die 'No se pudieron verificar los destinos de imágenes para el respaldo.'
  else
    IMAGE_PATHS_JSON=$(run_as_valweb node --input-type=commonjs -e 'require("dotenv").config({path:process.argv[1],override:true,quiet:true}); const {Pool}=require("pg"); (async()=>{const pool=new Pool({connectionString:process.env.DATABASE_URL}); try {const table="public.\"ImageStorageLocation\""; const {rows}=await pool.query("SELECT to_regclass($1) IS NOT NULL AS present", [table]); if(rows[0].present) throw new Error("storage helper unavailable"); process.stdout.write("[]\n")} finally {await pool.end()}})().catch(()=>{console.error("storage helper unavailable");process.exitCode=1})' "$CONFIG") || die 'La base ya usa almacenamiento administrado, pero esta versión no puede enumerarlo para el respaldo.'
  fi
  jq -e 'type == "array" and all(.[]; type == "string")' >/dev/null <<<"$IMAGE_PATHS_JSON" || die 'La lista de destinos de imágenes para el respaldo no es válida.'
  mapfile -t PERSISTED_IMAGE_PATHS < <(jq -r '.[]' <<<"$IMAGE_PATHS_JSON")
  (cd "$APP/current" && node --input-type=commonjs -e 'require("dotenv").config({path:process.argv[1],override:true}); const fs=require("node:fs"),{spawnSync}=require("node:child_process"); const paths=["var/lib/valweb","etc/valweb",process.env.IMAGE_STORAGE_DIR,process.env.IMPORT_STORAGE_DIR,...process.argv.slice(3)].filter(Boolean).map(p=>p.replace(/^\/+/,"")).filter((p,i,a)=>a.indexOf(p)===i&&fs.existsSync("/"+p)); const r=spawnSync("tar",["-C","/","--one-file-system","-czf",process.argv[2],"--",...paths],{stdio:"inherit"}); process.exit(r.status??1)' "$CONFIG" "$BACKUPS/$STAMP-data.tar.gz" "${PERSISTED_IMAGE_PATHS[@]}")
  chmod 600 "$BACKUPS/$STAMP"* 2>/dev/null || true
fi

if [[ $MODE != keep ]]; then
  RELEASE="$RELEASES/$TARGET"
  if [[ ! -d $RELEASE ]]; then cp -a "$TMP/source" "$RELEASE"; fi
  chown -R "valweb:$VALWEB_GROUP" "$RELEASE"
  chmod -R u=rwX,g=rX,o= "$RELEASE"
fi

DBPASS=''
if [[ ! -f $CONFIG ]]; then
  say 'Configuración inicial (la contraseña SMTP no se mostrará).'
  PUBLIC_URL=$(ask 'URL pública https://dominio (o http://IP)' 'http://localhost')
  APP_PORT=$(ask 'Puerto interno de Valweb' "$PORT_DEFAULT")
  [[ $APP_PORT =~ ^[0-9]{1,5}$ ]] && ((APP_PORT >= 1024 && APP_PORT <= 65535)) || die 'Puerto inválido.'
  TZ=$(ask 'Zona horaria' 'America/Mexico_City')
  SMTP_HOST=$(ask 'Servidor SMTP' 'smtp.office365.com')
  SMTP_PORT=$(ask 'Puerto SMTP (587 STARTTLS o 465 TLS implícito)' '587')
  SMTP_USER=$(ask 'Usuario SMTP' '')
  read -r -s -p 'Contraseña SMTP: ' SMTP_PASSWORD; printf '\n'
  SMTP_FROM=$(ask 'Correo remitente' "$SMTP_USER")
  ADMIN_EMAIL=$(ask 'Correo del administrador inicial' '')
  ADMIN_NAME=$(ask 'Nombre del administrador inicial' 'Administrador')
  read -r -s -p 'Contraseña inicial (mínimo 12 caracteres): ' ADMIN_PASSWORD; printf '\n'
  (( ${#ADMIN_PASSWORD} >= 12 && ${#ADMIN_PASSWORD} <= 128 )) || die 'Contraseña debe tener entre 12 y 128 caracteres.'
  valid_url "$PUBLIC_URL" || die 'La URL pública debe ser http(s)://dominio o IP, sin ruta.'
  [[ $TZ =~ ^[A-Za-z0-9_+/-]+$ ]] && node -e 'try{new Intl.DateTimeFormat("en",{timeZone:process.argv[1]})}catch{process.exit(1)}' "$TZ" || die 'Zona horaria inválida.'
  [[ $SMTP_PORT =~ ^(465|587)$ ]] || die 'Usa el puerto SMTP 465 o 587.'
  [[ $APP_PORT != "$SMTP_PORT" ]] || die 'El puerto de Valweb debe ser distinto al puerto SMTP.'
  [[ $ADMIN_EMAIL =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || die 'Correo administrador inválido.'
  [[ -n $SMTP_FROM ]] || SMTP_FROM=$SMTP_USER
  [[ $SMTP_FROM =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || die 'Correo remitente SMTP inválido.'
  [[ -n $SMTP_HOST ]] || die 'El servidor SMTP es obligatorio.'
  if [[ ${SMTP_HOST,,} == smtp.office365.com && ( -z $SMTP_USER || -z $SMTP_PASSWORD ) ]]; then die 'Office 365 requiere usuario y contraseña SMTP.'; fi
  DBPASS=$(openssl rand -hex 32)
  NEXTAUTH_SECRET=$(openssl rand -hex 48)
  runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_database WHERE datname='valweb'" | grep -q 1 && die 'Ya existe la base valweb. Configúrala manualmente para evitar modificar datos.'
  runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='valweb'" | grep -q 1 && die 'Ya existe el rol PostgreSQL valweb. Configúralo manualmente o instala en un LXC dedicado.'
  printf "CREATE ROLE valweb LOGIN PASSWORD '%s';\n" "$DBPASS" | runuser -u postgres -- psql -v ON_ERROR_STOP=1
  runuser -u postgres -- createdb -O valweb valweb
  {
    printf 'DATABASE_URL=%s\n' "$(envq "postgresql://valweb:${DBPASS}@127.0.0.1:5432/valweb")"
    printf 'NEXTAUTH_URL=%s\n' "$(envq "$PUBLIC_URL")"
    printf 'NEXTAUTH_SECRET=%s\n' "$(envq "$NEXTAUTH_SECRET")"
    printf 'APP_PORT=%s\nTZ=%s\n' "$APP_PORT" "$TZ"
    printf 'SMTP_HOST=%s\nSMTP_PORT=%s\n' "$(envq "$SMTP_HOST")" "$SMTP_PORT"
    printf 'SMTP_USER=%s\nSMTP_PASSWORD=%s\nSMTP_FROM=%s\n' "$(envq "$SMTP_USER")" "$(envq "$SMTP_PASSWORD")" "$(envq "$SMTP_FROM")"
    printf 'IMAGE_STORAGE_DIR=%s\nIMPORT_STORAGE_DIR=%s\n' "$DATA/images" "$DATA/imports"
    printf 'MAX_ZIP_BYTES=53687091200\nMAX_EXPANDED_BYTES=107374182400\nTRUST_PROXY=true\n'
    printf 'ADMIN_EMAIL=%s\nADMIN_NAME=%s\nADMIN_PASSWORD=%s\n' "$(envq "$ADMIN_EMAIL")" "$(envq "$ADMIN_NAME")" "$(envq "$ADMIN_PASSWORD")"
  } > "$CONFIG"
  chmod 640 "$CONFIG"
  chown "root:$VALWEB_GROUP" "$CONFIG"
  unset DBPASS NEXTAUTH_SECRET SMTP_PASSWORD ADMIN_PASSWORD
else
  chmod 640 "$CONFIG"
  chown "root:$VALWEB_GROUP" "$CONFIG"
  say "Se preserva configuración existente: $CONFIG"
  grep -q '^DATABASE_URL=' "$CONFIG" || die 'Falta DATABASE_URL; corrige la configuración sin reemplazarla.'
  CURRENT_URL=$(getenv NEXTAUTH_URL)
  [[ -n $CURRENT_URL ]] || die 'Falta NEXTAUTH_URL; corrige la configuración antes de continuar.'
  PUBLIC_URL=$(ask 'URL pública de Valweb' "$CURRENT_URL")
  valid_url "$PUBLIC_URL" || die 'La URL pública debe ser http(s)://dominio o IP, sin ruta.'
  if [[ $PUBLIC_URL != "$CURRENT_URL" ]]; then
    sed -i "s|^NEXTAUTH_URL=.*|NEXTAUTH_URL=$(envq "$PUBLIC_URL")|" "$CONFIG"
    URL_CHANGED=1
  fi
  for entry in 'APP_PORT=3000' 'TZ=America/Mexico_City' "IMAGE_STORAGE_DIR=$DATA/images" "IMPORT_STORAGE_DIR=$DATA/imports" 'MAX_ZIP_BYTES=53687091200' 'MAX_EXPANDED_BYTES=107374182400' 'TRUST_PROXY=true'; do
    key=${entry%%=*}; grep -q "^$key=" "$CONFIG" || printf '%s\n' "$entry" >> "$CONFIG"
  done
fi

# Do not source .env: it contains secrets and is dotenv syntax, not shell code.
PORT=$(getenv APP_PORT); PORT=${PORT:-3000}
mkdir -p "$DATA/images" "$DATA/imports"
own_data_dirs

if [[ $MODE != keep ]]; then
  ln -sfn "$CONFIG" "$RELEASE/.env"
  chown -R valweb:valweb "$RELEASE"
  su -s /bin/bash valweb -c "cd '$RELEASE' && npm ci --include=dev --no-audit --no-fund"
  run_as_valweb npx prisma generate
  run_as_valweb npm run build
  systemctl stop "$SERVICE" 2>/dev/null || true
  userctl stop "$WORKER" 2>/dev/null || true
  SERVICES_STOPPED=1
  run_as_valweb npx prisma migrate deploy
  if grep -q '^ADMIN_PASSWORD=' "$CONFIG"; then
    run_as_valweb node --import tsx scripts/seed-admin.ts
    sed -i '/^ADMIN_PASSWORD=/d' "$CONFIG"
  fi
  ln -sfn "$RELEASE" "$APP/current.new"
  mv -Tf "$APP/current.new" "$APP/current"
  SWITCHED=1
fi

if [[ -f $RELEASE/scripts/ensure-local-image-storage.ts ]]; then
  run_as_valweb env DEFAULT_LOCAL_IMAGE_ROOT="$DATA/images" node --import tsx scripts/ensure-local-image-storage.ts
fi

STAMP=${STAMP:-$(date -u +%Y%m%dT%H%M%SZ)}
VALWEB_UID=$(id -u valweb)
for unit in /etc/systemd/system/$SERVICE.service "$VALWEB_HOME/.config/systemd/user/$WORKER.service" /etc/nginx/sites-available/valweb; do
  [[ ! -f $unit ]] || cp -a "$unit" "$BACKUPS/$(basename "$unit").$STAMP.previous"
done
cat > /etc/systemd/system/$SERVICE.service <<EOF
[Unit]
Description=Valweb web application
After=network-online.target postgresql.service
Wants=network-online.target
[Service]
Type=simple
User=valweb
Group=$VALWEB_GROUP
WorkingDirectory=$APP/current
EnvironmentFile=$CONFIG
Environment=NODE_ENV=production
Environment=XDG_RUNTIME_DIR=/run/user/$VALWEB_UID
Environment=DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$VALWEB_UID/bus
ExecStart=/usr/bin/npm run start -- --port=$PORT
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
[Install]
WantedBy=multi-user.target
EOF
chmod 644 /etc/systemd/system/$SERVICE.service
if yesno '¿Probar conexión SMTP (no envía correo)?'; then
  if ! (cd "$APP/current" && node --input-type=commonjs -e 'require("dotenv").config({path:process.argv[1],override:true}); const nodemailer=require("nodemailer"); const t=nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT),secure:process.env.SMTP_PORT==="465",requireTLS:process.env.SMTP_HOST==="smtp.office365.com",connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,tls:{minVersion:"TLSv1.2"},...(process.env.SMTP_USER?{auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD}}:{})}); t.verify().then(()=>{console.log("SMTP verificado; no se envió ningún correo");t.close()}).catch(()=>{console.error("No se pudo verificar SMTP; revisa host, puerto y credenciales");process.exitCode=1;t.close()})' "$CONFIG"); then
    yesno 'SMTP falló. ¿Continuar de todos modos?' || die 'Corrige SMTP y vuelve a ejecutar el instalador.'
  fi
fi
for dir in "$VALWEB_HOME/.config" "$VALWEB_HOME/.config/systemd" "$VALWEB_HOME/.config/systemd/user"; do
  install -d "$dir"
  chown "valweb:$VALWEB_GROUP" "$dir"
  chmod 750 "$dir"
done
cat > "$VALWEB_HOME/.config/systemd/user/$WORKER.service" <<EOF
[Unit]
Description=Valweb import worker
After=network-online.target
[Service]
Type=simple
WorkingDirectory=$APP/current
EnvironmentFile=$CONFIG
Environment=NODE_ENV=production
ExecStart=/usr/bin/node --import tsx scripts/import-worker.ts
Restart=on-failure
RestartSec=5
KillMode=mixed
TimeoutStopSec=infinity
UMask=0077
NoNewPrivileges=true
ProtectSystem=full
[Install]
WantedBy=default.target
EOF
chown "valweb:$VALWEB_GROUP" "$VALWEB_HOME/.config/systemd/user/$WORKER.service"
chmod 644 "$VALWEB_HOME/.config/systemd/user/$WORKER.service"

DOMAIN=$(getenv NEXTAUTH_URL); DOMAIN=${DOMAIN#http://}; DOMAIN=${DOMAIN#https://}; DOMAIN=${DOMAIN%%/*}; DOMAIN=${DOMAIN%%:*}
[[ $DOMAIN =~ ^[A-Za-z0-9.-]+$ ]] || die 'Dominio inválido en NEXTAUTH_URL.'
cat > /etc/nginx/sites-available/valweb <<EOF
server {
  listen 80;
  server_name $DOMAIN;
  client_max_body_size 50g;
  location / { proxy_pass http://127.0.0.1:$PORT; proxy_http_version 1.1; proxy_set_header Host \$host; proxy_set_header X-Real-IP \$remote_addr; proxy_set_header X-Forwarded-For \$remote_addr; proxy_set_header X-Forwarded-Proto \$scheme; proxy_read_timeout 300s; }
}
EOF
ln -sfn /etc/nginx/sites-available/valweb /etc/nginx/sites-enabled/valweb
[[ ! -L /etc/nginx/sites-enabled/default ]] || rm -f /etc/nginx/sites-enabled/default
chmod 644 /etc/nginx/sites-available/valweb
nginx -t
systemctl daemon-reload
userctl daemon-reload
[[ -s $VALWEB_HOME/.config/systemd/user/$WORKER.service ]] || die 'No se creó la unidad del worker de importaciones.'
WORKER_FRAGMENT=$(userctl show -p FragmentPath --value "$WORKER")
[[ $WORKER_FRAGMENT == "$VALWEB_HOME/.config/systemd/user/$WORKER.service" ]] || die 'systemd no está cargando la unidad del worker desde el perfil de valweb.'
userctl enable --now "$WORKER"
userctl is-active --quiet "$WORKER" || die 'El worker de importaciones no pudo iniciar.'
systemctl enable --now nginx
systemctl reload nginx
if (( URL_CHANGED )); then systemctl restart "$SERVICE"; else systemctl enable --now "$SERVICE"; fi

if [[ -n ${ADMIN_EMAIL:-} ]]; then unset ADMIN_EMAIL ADMIN_NAME ADMIN_PASSWORD; fi
for attempt in {1..30}; do curl -fsS --max-time 3 "http://127.0.0.1:$PORT/login" >/dev/null 2>&1 && break; sleep 2; done
if ! curl -fsS --max-time 3 "http://127.0.0.1:$PORT/login" >/dev/null 2>&1; then
  journalctl -u "$SERVICE" -n 50 --no-pager >&2 || true
  die 'La aplicación no respondió en el puerto configurado. El instalador restaurará la versión anterior si existe.'
fi
say "Valweb está activo. commit ${TARGET:0:12}."
say "URL: $DOMAIN  |  Respaldo: $BACKUPS  |  Servicios: $SERVICE, $WORKER, nginx"
say "Imágenes: LOCAL predeterminado en $DATA/images; cada validación usa <tenantUUID>_<validationUUID>/por_procesar/ y /procesadas/."
say "FTP: concede a la cuenta de carga acceso de escritura y listado en por_procesar/ y lectura de sus archivos; alinea el GID del NFS externamente."
say 'SMTP debe usar 587/STARTTLS u Office365; HTTPS debe terminar en un proxy TLS externo.'
say 'Recuperación: detén servicios, restaura el symlink de release anterior y restaura el dump PostgreSQL solo tras confirmar el respaldo.'
