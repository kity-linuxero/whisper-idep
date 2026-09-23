#!/usr/bin/env bash
# whisper-idep (frontend) — instalador nativo para Debian 12/13 (LXC, VM o bare metal).
#
#   sudo ./install/app-install.sh --engine-url http://10.0.0.5:8080 --engine-token <token>
#
# Instala Node 20 + ffmpeg, la app como servicio systemd y verifica que llegue
# al motor. Idempotente: re-ejecutarlo actualiza el código y conserva la
# config y el historial.
set -euo pipefail

ENGINE_URL=""
ENGINE_TOKEN=""
PORT="3000"
BIND="0.0.0.0"
APP_SRC=""
APP_REPO="https://github.com/kity-linuxero/whisper-idep.git"
APP_REF="main"

APP_DIR=/opt/whisper-app
DATA_DIR=/var/lib/whisper-app
ETC_DIR=/etc/whisper-app
ENV_FILE=$ETC_DIR/app.env
SVC_USER=whisper-app

usage() {
  cat <<EOF
Uso: $0 --engine-url URL --engine-token TOKEN [opciones]

  --engine-url URL       URL de whisper-engine (ej. http://10.0.0.5:8080)
  --engine-token TOKEN   Token Bearer del motor
  --port 3000            Puerto de la app
  --bind 0.0.0.0         IP donde escuchar (la app NO tiene login: exponer solo detrás de un proxy con auth)
  --app-src DIR          Usar este checkout en vez de clonar
  --app-ref main         Rama/tag a clonar
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --engine-url) ENGINE_URL="$2"; shift 2 ;;
    --engine-token) ENGINE_TOKEN="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --bind) BIND="$2"; shift 2 ;;
    --app-src) APP_SRC="$2"; shift 2 ;;
    --app-ref) APP_REF="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Opción desconocida: $1" >&2; usage; exit 1 ;;
  esac
done

msg()  { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[aviso]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Correr como root."
if [[ ! -f "$ENV_FILE" ]]; then
  [[ -n "$ENGINE_URL" && -n "$ENGINE_TOKEN" ]] || die "Primera instalación: hacen falta --engine-url y --engine-token"
fi
export DEBIAN_FRONTEND=noninteractive

if [[ -z "$APP_SRC" ]]; then
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  if [[ -f "$here/package.json" ]] && grep -q '"name": "whisper-app"' "$here/package.json"; then
    APP_SRC="$here"
  fi
fi

msg "Instalando dependencias del sistema"
apt-get update -qq
# build-essential/python3: por si better-sqlite3 no tiene binario precompilado y hay que compilarlo.
apt-get install -y -qq --no-install-recommends ffmpeg curl ca-certificates git rsync gnupg \
  build-essential python3 >/dev/null

node_major() { node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/'; }
if [[ "$(node_major)" -lt 20 ]]; then
  apt-get install -y -qq --no-install-recommends nodejs npm >/dev/null || true
fi
if [[ "$(node_major)" -lt 20 ]]; then
  msg "Node.js del sistema es < 20; instalando Node 20 desde NodeSource"
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq && apt-get install -y -qq nodejs >/dev/null
fi
echo "node $(node -v)"

msg "Instalando whisper-app en $APP_DIR"
id "$SVC_USER" >/dev/null 2>&1 || useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$SVC_USER"
install -d -o "$SVC_USER" -g "$SVC_USER" -m 0750 "$DATA_DIR" "$DATA_DIR/data" "$DATA_DIR/uploads"
install -d -m 0750 -g "$SVC_USER" "$ETC_DIR"
if [[ -n "$APP_SRC" ]]; then
  rsync -a --delete --exclude node_modules --exclude .git --exclude data --exclude uploads \
    --exclude secrets --exclude .env "$APP_SRC/" "$APP_DIR/"
elif [[ ! -d "$APP_DIR/.git" ]]; then
  git clone -q --branch "$APP_REF" "$APP_REPO" "$APP_DIR"
else
  git -C "$APP_DIR" fetch -q origin && git -C "$APP_DIR" checkout -q "$APP_REF" && git -C "$APP_DIR" pull -q --ff-only || true
fi
(cd "$APP_DIR" && npm install --omit=dev --no-audit --no-fund --loglevel=error)

if [[ ! -f "$ENV_FILE" ]]; then
  cat > "$ENV_FILE" <<EOT
PORT=$PORT
HOST=$BIND
DB_PATH=$DATA_DIR/data/jobs.db
UPLOADS_DIR=$DATA_DIR/uploads
ENGINE_URL=$ENGINE_URL
ENGINE_TOKEN=$ENGINE_TOKEN
MAX_UPLOAD_MB=2048
MAX_JOB_MINUTES=90
EOT
else
  if [[ -n "$ENGINE_URL" ]]; then sed -i "s|^ENGINE_URL=.*|ENGINE_URL=$ENGINE_URL|" "$ENV_FILE"; fi
  if [[ -n "$ENGINE_TOKEN" ]]; then sed -i "s|^ENGINE_TOKEN=.*|ENGINE_TOKEN=$ENGINE_TOKEN|" "$ENV_FILE"; fi
fi
chown root:"$SVC_USER" "$ENV_FILE"
chmod 0640 "$ENV_FILE"

install -m 0644 "$APP_DIR/install/whisper-app.service" /etc/systemd/system/whisper-app.service
systemctl daemon-reload
systemctl enable -q whisper-app
systemctl restart whisper-app

msg "Verificando"
PORT_NOW="$(sed -n 's/^PORT=//p' "$ENV_FILE")"
for _ in $(seq 1 20); do
  curl -fsS "http://127.0.0.1:$PORT_NOW/api/health" >/dev/null 2>&1 && break
  sleep 1
done
health="$(curl -fsS "http://127.0.0.1:$PORT_NOW/api/health")" || { journalctl -u whisper-app -n 30 --no-pager; die "La app no levantó"; }
if echo "$health" | grep -q '"engine":{"ok":true'; then
  echo "Motor alcanzable: OK"
else
  warn "La app levantó pero no llega al motor: $health"
fi
curl -fsS "http://127.0.0.1:$PORT_NOW/api/models" >/dev/null || warn "No se pudieron listar los modelos (¿token incorrecto?)"

IP="$(hostname -I | awk '{print $1}')"
cat <<EOF

────────────────────────────────────────────────────────────
 whisper-app $(sed -nE 's/.*"version": "([^"]+)".*/\1/p' "$APP_DIR/package.json") instalada
   URL:     http://$IP:$PORT_NOW
   Config:  $ENV_FILE   (systemctl restart whisper-app tras editar)
   Datos:   $DATA_DIR
   Logs:    journalctl -u whisper-app -f

 IMPORTANTE: la app no tiene login propio. Para exponerla a internet,
 ponela detrás de un reverse proxy con autenticación.
────────────────────────────────────────────────────────────
EOF
