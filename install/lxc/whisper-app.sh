#!/usr/bin/env bash
# whisper-idep (frontend) — crea un LXC Debian 13 en Proxmox VE y instala la app adentro.
# Se corre en el HOST de Proxmox, como root:
#
#   ./install/lxc/whisper-app.sh --engine-url http://192.168.1.50:8080 --engine-token <token> \
#       --ip 192.168.1.60/24 --gw 192.168.1.1
#
# Todo lo que no se pase por flag usa un default razonable; antes de crear
# nada muestra un resumen y pide confirmación (salvo --yes).
set -euo pipefail
export LANG=C.UTF-8 LC_ALL=C.UTF-8

CTID=""
HOSTNAME_="whisper-app"
STORAGE=""
TEMPLATE_STORAGE="local"
BRIDGE="vmbr0"
VLAN=""
IP="dhcp"
GW=""
DNS=""
CORES=2
MEMORY=1024
SWAP=512
DISK=8
ONBOOT=1
YES=0
INSTALL_ARGS=()
APP_REPO_RAW="https://raw.githubusercontent.com/kity-linuxero/whisper-idep/main"

usage() {
  cat <<EOF
Uso: $0 [opciones]

Contenedor:
  --ctid N               ID del CT (default: el próximo libre)
  --hostname NAME        (default: whisper-app)
  --storage NAME         Storage para el rootfs (default: el primero que admita contenedores)
  --template-storage N   Storage de plantillas (default: local)
  --bridge vmbr0         Bridge de red
  --vlan N               Tag de VLAN (opcional)
  --ip dhcp|CIDR         ej. 192.168.1.50/24 (default: dhcp)
  --gw IP                Gateway (obligatorio con IP fija)
  --dns IP               Servidor DNS (default: el del host)
  --cores N              (default: 2)   --memory MB (default: 1024)   --disk GB (default: 8)
  --no-onboot            No arrancar el CT con el host
  --yes                  No pedir confirmación

App (se pasan a app-install.sh):
  --engine-url URL       URL de whisper-engine (obligatorio)
  --engine-token TOKEN   Token del motor (obligatorio)
  --port 3000            --app-ref REF
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ctid) CTID="$2"; shift 2 ;;
    --hostname) HOSTNAME_="$2"; shift 2 ;;
    --storage) STORAGE="$2"; shift 2 ;;
    --template-storage) TEMPLATE_STORAGE="$2"; shift 2 ;;
    --bridge) BRIDGE="$2"; shift 2 ;;
    --vlan) VLAN="$2"; shift 2 ;;
    --ip) IP="$2"; shift 2 ;;
    --gw) GW="$2"; shift 2 ;;
    --dns) DNS="$2"; shift 2 ;;
    --cores) CORES="$2"; shift 2 ;;
    --memory) MEMORY="$2"; shift 2 ;;
    --disk) DISK="$2"; shift 2 ;;
    --no-onboot) ONBOOT=0; shift ;;
    --yes|-y) YES=1; shift ;;
    --engine-url|--engine-token|--port|--app-ref)
      INSTALL_ARGS+=("$1" "$2"); shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Opción desconocida: $1" >&2; usage; exit 1 ;;
  esac
done

msg()  { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[aviso]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Correr como root en el host de Proxmox."
command -v pct >/dev/null || die "No se encontró 'pct': esto se corre en un host Proxmox VE."
printf '%s\n' "${INSTALL_ARGS[@]}" | grep -qx -- --engine-url || die "Falta --engine-url"
printf '%s\n' "${INSTALL_ARGS[@]}" | grep -qx -- --engine-token || die "Falta --engine-token"
[[ "$IP" == "dhcp" || "$IP" =~ ^[0-9.]+/[0-9]+$ ]] || die "--ip tiene que ser dhcp o una dirección CIDR (ej. 192.168.1.50/24)"
[[ "$IP" == "dhcp" || -n "$GW" ]] || die "Con IP fija hace falta --gw"

[[ -n "$CTID" ]] || CTID="$(pvesh get /cluster/nextid)"
pct status "$CTID" >/dev/null 2>&1 && die "Ya existe un CT con ID $CTID"
if [[ -z "$STORAGE" ]]; then
  STORAGE="$(pvesm status -content rootdir 2>/dev/null | awk 'NR>1 && $3=="active" {print $1; exit}')"
  [[ -n "$STORAGE" ]] || die "No encontré un storage para contenedores; pasar --storage"
fi

# Código de la app: el checkout donde vive este script, o lo bajamos de GitHub.
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [[ ! -f "$SRC_DIR/install/app-install.sh" ]]; then
  SRC_DIR=""
fi

# Plantilla Debian 13 más nueva disponible.
pveam update >/dev/null 2>&1 || warn "pveam update falló; uso las plantillas ya conocidas"
TEMPLATE="$(pveam available --section system | awk '{print $2}' | grep -E '^debian-13-standard_.*_amd64' | sort -V | tail -1)"
[[ -n "$TEMPLATE" ]] || TEMPLATE="$(pveam list "$TEMPLATE_STORAGE" | awk -F'[/ ]' '/debian-13-standard/ {print $2}' | sort -V | tail -1)"
[[ -n "$TEMPLATE" ]] || die "No encontré la plantilla debian-13-standard"

NET="name=eth0,bridge=$BRIDGE,ip=$IP"
[[ -n "$GW" ]] && NET+=",gw=$GW"
[[ -n "$VLAN" ]] && NET+=",tag=$VLAN"

cat <<EOF

Se va a crear:
  CT $CTID ($HOSTNAME_)  Debian: $TEMPLATE
  Storage: $STORAGE  Disco: ${DISK}G  CPU: $CORES  RAM: ${MEMORY}MB
  Red: $NET
  Motor: $(printf '%s\n' "${INSTALL_ARGS[@]}" | grep -A1 -x -- --engine-url | tail -1)
  Código: ${SRC_DIR:-GitHub (kity-linuxero/whisper-idep)}
EOF
if [[ $YES == 0 ]]; then
  read -r -p "¿Continuar? [s/N] " ans
  [[ "$ans" =~ ^[sSyY]$ ]] || exit 1
fi

if ! pveam list "$TEMPLATE_STORAGE" | grep -q "$TEMPLATE"; then
  msg "Descargando plantilla $TEMPLATE"
  pveam download "$TEMPLATE_STORAGE" "$TEMPLATE" >/dev/null
fi

msg "Creando CT $CTID"
create_args=(
  --hostname "$HOSTNAME_"
  --ostype debian
  --unprivileged 1
  --features nesting=1
  --cores "$CORES" --memory "$MEMORY" --swap "$SWAP"
  --rootfs "$STORAGE:$DISK"
  --net0 "$NET"
  --onboot "$ONBOOT"
  --description "whisper-app — frontend de transcripción. https://github.com/kity-linuxero/whisper-idep"
)
[[ -n "$DNS" ]] && create_args+=(--nameserver "$DNS")
pct create "$CTID" "$TEMPLATE_STORAGE:vztmpl/$TEMPLATE" "${create_args[@]}" >/dev/null
pct start "$CTID"

# Esperar red.
for _ in $(seq 1 30); do
  pct exec "$CTID" -- bash -c 'ip -4 route | grep -q default' 2>/dev/null && break
  sleep 1
done

if [[ "$IP" != "dhcp" ]]; then
  # Detección de IP duplicada (ARP DAD) antes de seguir: una IP fija ya usada por
  # otro equipo da cortes intermitentes muy difíciles de diagnosticar.
  pct exec "$CTID" -- bash -c 'apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq iputils-arping >/dev/null' \
    || warn "No se pudo instalar arping; salteo la verificación de IP duplicada"
  # arping -D: 0 = nadie más responde por esa IP, 1 = duplicada, otro = no se pudo verificar.
  rc=0; pct exec "$CTID" -- arping -D -q -c 3 -I eth0 "${IP%/*}" || rc=$?
  [[ $rc -gt 1 ]] && warn "No se pudo verificar si la IP está duplicada (arping rc=$rc)"
  if [[ $rc -eq 1 ]]; then
    pct stop "$CTID"
    die "La IP ${IP%/*} ya está en uso por otro equipo. El CT $CTID quedó creado y apagado: cambiá la IP con 'pct set $CTID -net0 ...' o borralo con 'pct destroy $CTID'."
  fi
fi

msg "Copiando instalador al CT"
pct exec "$CTID" -- mkdir -p /root/whisper-app-src
if [[ -n "$SRC_DIR" ]]; then
  tarball="$(mktemp --suffix=.tgz)"
  tar -C "$SRC_DIR" --exclude=node_modules --exclude=.git --exclude=./data --exclude=./uploads \
    --exclude=./secrets --exclude=./.env -czf "$tarball" .
  pct push "$CTID" "$tarball" /root/whisper-app-src.tgz
  rm -f "$tarball"
  pct exec "$CTID" -- tar -C /root/whisper-app-src -xzf /root/whisper-app-src.tgz
  pct exec "$CTID" -- rm -f /root/whisper-app-src.tgz
  INSTALL_ARGS+=(--app-src /root/whisper-app-src)
else
  pct exec "$CTID" -- bash -c "apt-get update -qq && apt-get install -y -qq curl ca-certificates >/dev/null && \
    mkdir -p /root/whisper-app-src/install && \
    curl -fsSL -o /root/whisper-app-src/install/app-install.sh $APP_REPO_RAW/install/app-install.sh"
fi

msg "Instalando whisper-app dentro del CT $CTID"
pct exec "$CTID" -- bash /root/whisper-app-src/install/app-install.sh "${INSTALL_ARGS[@]}"

echo
echo "Listo. CT $CTID ($HOSTNAME_). Consola: pct enter $CTID"
