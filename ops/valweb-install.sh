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
say(){ printf '\n\033[1;36mValweb\033[0m %s\n' "$*"; }
die(){ printf '\nERROR: %s\n' "$*" >&2; if [[ -n $OLD_LINK ]]; then (( SWITCHED )) && ln -sfn "$OLD_LINK" "$APP/current"; if (( SERVICES_STOPPED )); then systemctl restart "$SERVICE" 2>/dev/null || true; userctl restart "$WORKER" 2>/dev/null || true; fi; fi; exit 1; }
ask(){ local prompt=$1 default=$2 value; read -r -p "$prompt [$default]: " value; printf '%s' "${value:-$default}"; }
yesno(){ local prompt=$1 answer; read -r -p "$prompt [s/N]: " answer; [[ $answer =~ ^[sS]$ ]]; }
envq(){ local value=$1; [[ $value != *$'\n'* && $value != *$'\r'* ]] || die 'No se admiten saltos de línea en variables de entorno.'; value=${value//\\/\\\\}; value=${value//\"/\\\"}; printf '"%s"' "$value"; }
cleanup(){ [[ -z $TMP ]] || rm -rf -- "$TMP"; }
trap cleanup EXIT
userctl(){ local uid; uid=$(id -u valweb); runuser -u valweb -- env XDG_RUNTIME_DIR="/run/user/$uid" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$uid/bus" systemctl --user "$@"; }
on_error(){ local code=$?; trap - ERR; if [[ -n $OLD_LINK ]]; then (( SWITCHED )) && ln -sfn "$OLD_LINK" "$APP/current"; if (( SERVICES_STOPPED )); then systemctl restart "$SERVICE" 2>/dev/null || true; userctl restart "$WORKER" 2>/dev/null || true; fi; fi; printf '\nERROR: Falló la línea %s (código %s). Se intentó volver al release anterior. Revisa el respaldo en %s; no se revierte automáticamente la base de datos.\n' "$1" "$code" "$BACKUPS" >&2; exit "$code"; }
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
[[ ${1:-} == --check ]] && { bash -n "$0" && [[ $(envq 'a b#$x"') == '"a b#$x\""' ]] && printf 'Sintaxis y codificación de entorno correctas.\n'; exit; }
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

# Node 24 LTS from the NodeSource Debian/Ubuntu repository; the app requires a current Node runtime.
if ! command -v node >/dev/null || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) < 24)'; then
  curl -fsSL https://deb.nodesource.com/setup_24.x -o /tmp/valweb-nodesource.sh
  bash /tmp/valweb-nodesource.sh
  apt-get install -y nodejs
  rm -f /tmp/valweb-nodesource.sh
fi
node -e 'if(Number(process.versions.node.split(".")[0])<24)process.exit(1)' || die 'Se necesita Node.js 24 LTS o superior.'

TMP=$(mktemp -d /tmp/valweb-manager.XXXXXX)
chmod 700 "$TMP"
mkdir -p "$RELEASES" "$DATA/images" "$DATA/imports" "$BACKUPS" /etc/valweb
chmod 700 /etc/valweb "$BACKUPS"
if ! id valweb >/dev/null 2>&1; then useradd --system --home-dir "$APP" --create-home --shell /usr/sbin/nologin valweb; fi
chown -R valweb:valweb "$APP" "$DATA"
loginctl enable-linger valweb
systemctl start "user@$(id -u valweb).service"

INSTALLED=""
if [[ -L $APP/current ]]; then INSTALLED=$(git -C "$APP/current" rev-parse HEAD 2>/dev/null || true); fi
[[ -n $INSTALLED ]] || INSTALLED=ninguno
if yesno '¿Buscar versiones y actualizaciones de Valweb en GitHub?'; then SEARCH=1; else SEARCH=0; fi
[[ $SEARCH == 1 ]] || { [[ $INSTALLED != ninguno ]] || die 'No hay una instalación para conservar.'; TARGET=$INSTALLED; MODE=keep; }

if [[ $SEARCH == 1 ]]; then
  curl -fsSL "$API" -o "$TMP/repo.json"
  BRANCH=$(jq -er '.default_branch' "$TMP/repo.json")
  curl -fsSL "$API/releases?per_page=20" -o "$TMP/releases.json"
  curl -fsSL "$API/commits?sha=$BRANCH&per_page=10" -o "$TMP/commits.json"
  RELEASE_COUNT=$(jq 'length' "$TMP/releases.json")
  printf '\nRama principal: %s\nCommit instalado: %s\nReleases estables publicadas: %s\n' "$BRANCH" "${INSTALLED:0:12}" "$RELEASE_COUNT"
  jq -r '.[] | "  \(.sha[0:10])  \(.commit.author.date)  \(.commit.message | split("\\n")[0])"' "$TMP/commits.json"
  (( RELEASE_COUNT > 0 )) || printf 'Este repositorio no tiene releases estables publicadas.\n'
  printf '\n[1] Última release estable (recomendada)\n[2] Último commit de %s (desarrollo)\n[3] Elegir entre los 10 commits recientes (desarrollo)\n[4] Introducir hash de commit\n' "$BRANCH"
  [[ $INSTALLED == ninguno ]] || printf '[5] Mantener instalación actual\n'
  read -r -p 'Selecciona versión: ' choice
  case $choice in
    1) (( RELEASE_COUNT > 0 )) || die 'No hay release estable. Publica una release o selecciona explícitamente desarrollo.'; TARGET=$(jq -er 'map(select(.draft|not) | select(.prerelease|not))[0].tag_name' "$TMP/releases.json"); MODE=stable ;;
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
  if [[ $INSTALLED != ninguno ]] && git -C "$APP/current" cat-file -e "$INSTALLED^{commit}" 2>/dev/null; then git -C "$APP/current" log --oneline "$INSTALLED..$TARGET" | head -20; fi
  yesno '¿Continuar con esta versión?' || exit 0
fi

if [[ $INSTALLED != ninguno ]]; then
  [[ -f $CONFIG ]] || die 'Hay un release existente pero falta /etc/valweb/.env. Recupéralo antes de actualizar.'
  OLD_LINK=$(readlink -f "$APP/current")
  say 'Creando respaldo antes de detener servicios.'
  STAMP=$(date -u +%Y%m%dT%H%M%SZ)
  if ! grep -q '^IMAGE_STORAGE_DIR=' "$CONFIG" && [[ -d $APP/current/var/assets ]] && [[ -z $(find "$DATA/images" -mindepth 1 -print -quit) ]]; then cp -a "$APP/current/var/assets/." "$DATA/images/"; fi
  if ! grep -q '^IMPORT_STORAGE_DIR=' "$CONFIG" && [[ -d $APP/current/var/imports ]] && [[ -z $(find "$DATA/imports" -mindepth 1 -print -quit) ]]; then cp -a "$APP/current/var/imports/." "$DATA/imports/"; fi
  chown -R valweb:valweb "$DATA"
  (cd "$APP/current" && node --input-type=commonjs -e 'require("dotenv").config({path:process.argv[1],override:true}); const {spawnSync}=require("node:child_process"); const u=new URL(process.env.DATABASE_URL); const env={...process.env,PGHOST:u.hostname,PGPORT:u.port||"5432",PGUSER:decodeURIComponent(u.username),PGPASSWORD:decodeURIComponent(u.password),PGDATABASE:decodeURIComponent(u.pathname.slice(1)),PGSSLMODE:u.searchParams.get("sslmode")||"disable"}; const r=spawnSync("pg_dump",["--format=custom","--no-owner","--no-acl","--file",process.argv[2],"--dbname",env.PGDATABASE],{env,stdio:"inherit"}); process.exit(r.status??1)' "$CONFIG" "$BACKUPS/$STAMP.dump")
  (cd "$APP/current" && node --input-type=commonjs -e 'require("dotenv").config({path:process.argv[1],override:true}); const fs=require("node:fs"),{spawnSync}=require("node:child_process"); const paths=["var/lib/valweb","etc/valweb",process.env.IMAGE_STORAGE_DIR,process.env.IMPORT_STORAGE_DIR].filter(Boolean).map(p=>p.replace(/^\/+/,"")).filter((p,i,a)=>a.indexOf(p)===i&&fs.existsSync("/"+p)); const r=spawnSync("tar",["-C","/","-czf",process.argv[2],"--",...paths],{stdio:"inherit"}); process.exit(r.status??1)' "$CONFIG" "$BACKUPS/$STAMP-data.tar.gz")
  chmod 600 "$BACKUPS/$STAMP"* 2>/dev/null || true
fi

if [[ $MODE != keep ]]; then
  RELEASE="$RELEASES/$TARGET"
  if [[ ! -d $RELEASE ]]; then cp -a "$TMP/source" "$RELEASE"; fi
  chown -R valweb:valweb "$RELEASE"
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
  DBPASS=$(openssl rand -hex 32)
  NEXTAUTH_SECRET=$(openssl rand -hex 48)
  runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='valweb'" | grep -q 1 && die 'Ya existe el rol PostgreSQL valweb. Configúralo manualmente o instala en un LXC dedicado.'
  printf "CREATE ROLE valweb LOGIN PASSWORD '%s';\n" "$DBPASS" | runuser -u postgres -- psql -v ON_ERROR_STOP=1
  runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_database WHERE datname='valweb'" | grep -q 1 && die 'Ya existe la base valweb. Configúrala manualmente o instala en un LXC dedicado.'
  runuser -u postgres -- createdb -O valweb valweb
  [[ $PUBLIC_URL =~ ^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?/?$ ]] || die 'La URL pública debe ser http(s)://dominio o IP, sin ruta.'
  [[ $TZ =~ ^[A-Za-z0-9_+/-]+$ && $SMTP_PORT =~ ^(465|587)$ ]] || die 'Zona horaria o puerto SMTP inválidos (usa 465 o 587).'
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
  chown root:valweb "$CONFIG"
  unset DBPASS NEXTAUTH_SECRET SMTP_PASSWORD ADMIN_PASSWORD
else
  chmod 640 "$CONFIG"
  chown root:valweb "$CONFIG"
  say "Se preserva configuración existente: $CONFIG"
  grep -q '^DATABASE_URL=' "$CONFIG" || die 'Falta DATABASE_URL; corrige la configuración sin reemplazarla.'
  for entry in 'APP_PORT=3000' 'TZ=America/Mexico_City' "IMAGE_STORAGE_DIR=$DATA/images" "IMPORT_STORAGE_DIR=$DATA/imports" 'MAX_ZIP_BYTES=53687091200' 'MAX_EXPANDED_BYTES=107374182400' 'TRUST_PROXY=true'; do
    key=${entry%%=*}; grep -q "^$key=" "$CONFIG" || printf '%s\n' "$entry" >> "$CONFIG"
  done
fi

# Do not source .env: it contains secrets and is dotenv syntax, not shell code.
getenv(){ sed -n "s/^$1=//p" "$CONFIG" | tail -n1 | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"; }
PORT=$(getenv APP_PORT); PORT=${PORT:-3000}
install -d -o valweb -g valweb "$DATA/images" "$DATA/imports"

if [[ $MODE != keep ]]; then
  ln -sfn "$CONFIG" "$RELEASE/.env"
  chown -R valweb:valweb "$RELEASE"
  su -s /bin/bash valweb -c "cd '$RELEASE' && npm ci --include=dev --no-audit --no-fund"
  su -s /bin/bash valweb -c "cd '$RELEASE' && npx prisma generate && npm run build"
  systemctl stop "$SERVICE" 2>/dev/null || true
  userctl stop "$WORKER" 2>/dev/null || true
  SERVICES_STOPPED=1
  su -s /bin/bash valweb -c "cd '$RELEASE' && npx prisma migrate deploy"
  if grep -q '^ADMIN_PASSWORD=' "$CONFIG"; then
    su -s /bin/bash valweb -c "cd '$RELEASE' && node --import tsx scripts/seed-admin.ts"
    sed -i '/^ADMIN_PASSWORD=/d' "$CONFIG"
  fi
  ln -sfn "$RELEASE" "$APP/current.new"
  mv -Tf "$APP/current.new" "$APP/current"
  SWITCHED=1
fi

STAMP=${STAMP:-$(date -u +%Y%m%dT%H%M%SZ)}
for unit in /etc/systemd/system/$SERVICE.service /etc/systemd/user/$WORKER.service /etc/nginx/sites-available/valweb; do
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
Group=valweb
WorkingDirectory=$APP/current
EnvironmentFile=$CONFIG
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm run start -- --port=$PORT
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
[Install]
WantedBy=multi-user.target
EOF
if yesno '¿Probar conexión SMTP (no envía correo)?'; then
  if ! (cd "$APP/current" && node --input-type=commonjs -e 'require("dotenv").config({path:process.argv[1],override:true}); const nodemailer=require("nodemailer"); const t=nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT),secure:process.env.SMTP_PORT==="465",requireTLS:process.env.SMTP_HOST==="smtp.office365.com",connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,tls:{minVersion:"TLSv1.2"},...(process.env.SMTP_USER?{auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD}}:{})}); t.verify().then(()=>{console.log("SMTP verificado; no se envió ningún correo");t.close()}).catch(()=>{console.error("No se pudo verificar SMTP; revisa host, puerto y credenciales");process.exitCode=1;t.close()})' "$CONFIG"); then
    yesno 'SMTP falló. ¿Continuar de todos modos?' || die 'Corrige SMTP y vuelve a ejecutar el instalador.'
  fi
fi
install -d /etc/systemd/user
cat > /etc/systemd/user/$WORKER.service <<EOF
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
nginx -t
systemctl daemon-reload
systemctl enable --now postgresql nginx "$SERVICE"
userctl daemon-reload
userctl enable --now "$WORKER"

if [[ -n ${ADMIN_EMAIL:-} ]]; then unset ADMIN_EMAIL ADMIN_NAME ADMIN_PASSWORD; fi
for attempt in {1..30}; do curl -fsS "http://127.0.0.1:$PORT/login" >/dev/null && break; sleep 2; done
curl -fsS "http://127.0.0.1:$PORT/login" >/dev/null || die 'La aplicación no respondió. Revisa journalctl; conserva el respaldo para recuperación.'
say "Valweb está activo. commit $(git -C "$APP/current" rev-parse --short HEAD)."
say "URL: $DOMAIN  |  Respaldo: $BACKUPS  |  Servicios: $SERVICE, $WORKER, nginx"
say 'SMTP debe usar 587/STARTTLS u Office365; HTTPS debe terminar en un proxy TLS externo.'
say 'Recuperación: detén servicios, restaura el symlink de release anterior y restaura el dump PostgreSQL solo tras confirmar el respaldo.'
