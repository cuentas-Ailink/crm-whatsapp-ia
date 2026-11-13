#!/bin/bash
# Instala o actualiza el CRM con una sola línea, y lo abre en el navegador.
#
#   curl -fsSL https://raw.githubusercontent.com/cuentas-Ailink/crm-whatsapp-ia/main/instalar.sh | bash
#   bash instalar.sh                  dentro de una copia del CRM: la prepara ahí mismo
#   bash instalar.sh --sin-arrancar   lo deja todo listo sin abrirlo (para las pruebas y GitHub)
#   … | sudo bash -s -- --servidor crm.tunegocio.com   en un VPS con Ubuntu 24.04 (ver DESPLEGAR.md)
#   bash instalar.sh --servidor crm.tunegocio.com --simular   escribe los pasos del VPS sin ejecutar nada
#
# Fuera de una copia descarga el CRM en ~/crm-whatsapp (o en CRM_DIR) sin git. Volver a ejecutarlo
# actualiza el código y nunca toca tus datos: .env, .env.local, agente.md, datos/, copias/, logs/ ni
# tus archivos de negocios/. CRM_TARBALL cambia de dónde se descarga (una dirección o un archivo).
# No instala Node.js: si falta, dice de dónde bajarlo. Probado en Mac.
#
# Funciona con el bash 3.2 del Mac. Todo va dentro de funciones y la última línea es «main "$@"»:
# con «curl … | bash» bash lee el script entero antes de ejecutar nada, y una descarga cortada no
# ejecuta nada. En ese caso la entrada estándar es el propio script, así que nada lee de ella.

set -u

URL_TARBALL="https://codeload.github.com/cuentas-Ailink/crm-whatsapp-ia/tar.gz/refs/heads/main"
CARPETA=""
MODO=""
ARRANCAR=1
TEMPORAL=""

ok() {
  printf '\033[32m✓\033[0m %s\n' "$1"
}

fallar() {
  printf '\033[31m✗ %s\033[0m\n' "$1"
  exit "${2:-1}"
}

# Cómo se pide volver a probar: en una copia se ejecuta el archivo; si no, se pega otra vez el comando.
volver() {
  if [ "$MODO" = "copia" ]; then
    printf 'vuelve a ejecutar: bash instalar.sh'
  else
    printf 'vuelve a pegar el comando'
  fi
}

# Lo mismo al final de una frase: tras el comando no va punto, para que se pueda copiar tal cual.
volver_fin() {
  if [ "$MODO" = "copia" ]; then
    volver
  else
    printf '%s.' "$(volver)"
  fi
}

limpiar() {
  if [ -n "$TEMPORAL" ] && [ -d "$TEMPORAL" ]; then
    rm -rf "$TEMPORAL"
  fi
  TEMPORAL=""
}

leer_opciones() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --sin-arrancar) ARRANCAR=0 ;;
      *) fallar "No conozco la opción $1." 2 ;;
    esac
    shift
  done
}

# «copia» si este archivo está dentro de una copia del CRM; si no, «descarga» en CRM_DIR.
elegir_carpeta() {
  local fuente="${BASH_SOURCE[0]:-}"
  local carpeta
  if [ -n "$fuente" ] && [ -f "$fuente" ]; then
    carpeta="$(cd "$(dirname "$fuente")" && pwd)"
    if [ -f "$carpeta/package.json" ] && grep -q '"name": *"crm-whatsapp-ia"' "$carpeta/package.json" </dev/null; then
      MODO="copia"
      CARPETA="$carpeta"
      return
    fi
  fi
  MODO="descarga"
  CARPETA="${CRM_DIR:-$HOME/crm-whatsapp}"
}

comprobar_node() {
  if ! command -v node >/dev/null 2>&1 ||
    ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' </dev/null >/dev/null 2>&1; then
    fallar "Falta Node.js 22.13 o superior. Instálalo desde https://nodejs.org/es/download (el instalador para Mac) y $(volver_fin)"
  fi
}

# Reconstruir con el CRM abierto lo rompe. Se mira el cerrojo de sus datos, nunca un puerto.
comprobar_cerrado() {
  local cerrojo="$CARPETA/datos/.crm-abierto"
  local pid
  [ -f "$cerrojo" ] || return 0
  pid="$(sed -n 's/.*"pid"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$cerrojo" </dev/null | head -n 1)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    fallar "Tu CRM está abierto. Ciérralo (Ctrl+C en su ventana) y $(volver_fin)"
  fi
}

# Lo que es del usuario y una actualización nunca escribe ni borra.
protegido() {
  case "$1" in
    .env | .env.local | agente.md) return 0 ;;
    datos/* | copias/* | logs/* | node_modules/* | .next/*) return 0 ;;
    negocios/ejemplo-peluqueria.json) return 1 ;;
    negocios/*) return 0 ;;
  esac
  return 1
}

# Descarga la versión nueva y la copia en $1 archivo a archivo, sin tocar lo protegido. Borra lo que
# la versión anterior instaló y la nueva ya no trae: next build revisa todos los .ts de la carpeta y
# uno que sobre puede romper la actualización. Lo que el usuario añadió nunca está en la lista.
descargar_en() {
  local destino="$1"
  local origen="${CRM_TARBALL:-$URL_TARBALL}"
  local archivo relativo linea
  TEMPORAL="$(mktemp -d)" || fallar "No se ha podido descargar el CRM. Comprueba la conexión a internet y $(volver_fin)"
  mkdir -p "$TEMPORAL/codigo"
  case "$origen" in
    http://* | https://*) curl -fsSL --retry 2 -o "$TEMPORAL/crm.tar.gz" "$origen" </dev/null >/dev/null 2>&1 ;;
    *) cp "$origen" "$TEMPORAL/crm.tar.gz" </dev/null >/dev/null 2>&1 ;;
  esac &&
    tar -xzf "$TEMPORAL/crm.tar.gz" --strip-components=1 -C "$TEMPORAL/codigo" </dev/null >/dev/null 2>&1 &&
    [ -f "$TEMPORAL/codigo/package.json" ] ||
    fallar "No se ha podido descargar el CRM. Comprueba la conexión a internet y $(volver_fin)"

  mkdir -p "$destino" || fallar "No se ha podido descargar el CRM. Comprueba la conexión a internet y $(volver_fin)"
  : >"$TEMPORAL/nuevos"
  while IFS= read -r -d '' archivo; do
    relativo="${archivo#./}"
    protegido "$relativo" && continue
    mkdir -p "$destino/$(dirname "$relativo")" &&
      cp -p "$TEMPORAL/codigo/$relativo" "$destino/$relativo" </dev/null ||
      fallar "No se ha podido descargar el CRM. Comprueba la conexión a internet y $(volver_fin)"
    printf '%s\n' "$relativo" >>"$TEMPORAL/nuevos"
  done < <(cd "$TEMPORAL/codigo" && find . \( -type f -o -type l \) -print0)

  if [ -f "$destino/.crm-archivos" ]; then
    sort -u "$destino/.crm-archivos" >"$TEMPORAL/antes"
    sort -u "$TEMPORAL/nuevos" >"$TEMPORAL/ahora"
    while IFS= read -r linea; do
      case "$linea" in
        "" | /* | ../* | */../* | *"/.." | ..) continue ;;
      esac
      protegido "$linea" && continue
      if [ -f "$destino/$linea" ] || [ -L "$destino/$linea" ]; then
        rm -f "$destino/$linea"
      fi
    done < <(comm -23 "$TEMPORAL/antes" "$TEMPORAL/ahora")
  fi
  cp "$TEMPORAL/nuevos" "$destino/.crm-archivos"
  limpiar
}

preparar() {
  local registro="$CARPETA/logs/instalacion.log"
  cd "$CARPETA" || fallar "No se ha podido abrir la carpeta $CARPETA."
  mkdir -p logs
  export npm_config_update_notifier=false
  if command -v pnpm >/dev/null 2>&1; then
    pnpm install --frozen-lockfile </dev/null >>"$registro" 2>&1
  else
    # Sin pnpm se usa una copia temporal: es el único uso de npx en este proyecto.
    npx --yes pnpm@11.9.0 install --frozen-lockfile </dev/null >>"$registro" 2>&1
  fi || fallar "No se han podido instalar las piezas del CRM. Comprueba la conexión a internet y $(volver). El detalle está en $registro."
  # Su propia línea de error, si falla.
  node scripts/instalar.mjs </dev/null || exit 1
}

escribir_lanzador() {
  local lanzador="$CARPETA/Abrir CRM.command"
  printf '#!/bin/bash\ncd "$(dirname "$0")" && exec bash arrancar.sh\n' >"$lanzador"
  chmod +x "$lanzador"
}

# ─── Modo servidor ──────────────────────────────────────────────────────────────────────────────────
#
#   curl -fsSL …/instalar.sh | sudo bash -s -- --servidor crm.tunegocio.com            instala o actualiza
#   bash instalar.sh --servidor crm.tunegocio.com --simular        escribe los pasos sin ejecutar nada
#
# Prepara un VPS con Ubuntu 24.04: usuario propio (crm), Node.js oficial comprobado con SHASUMS256.txt,
# Caddy (HTTPS) de su repositorio oficial, el servicio de systemd y el cortafuegos. En pantalla solo
# salen las líneas de cada paso; el detalle va a {carpeta}/logs/instalacion.log.
# Seguridad: todo lo que se escribe dentro de la carpeta del CRM lo escribe el usuario crm (runuser),
# nunca root: así un enlace simbólico que alguien dejase ahí no sirve para escribir fuera.

DOMINIO=""
SIMULAR=0
REGISTRO_SERVIDOR=""
TEMPORAL_SERVIDOR=""
USUARIO_NUEVO=0
SERVICIO_EXISTIA=0
PRIMERA_VEZ=0
CODIGO=""
ARQUITECTURA=""
CASA_CRM="/var/lib/crm"
URL_NODE="https://nodejs.org/dist/latest-v24.x"
SERVICIO="/etc/systemd/system/crm-whatsapp.service"
INSTALADOR_URL="https://raw.githubusercontent.com/cuentas-Ailink/crm-whatsapp-ia/main/instalar.sh"

aviso() {
  printf '\033[33m! %s\033[0m\n' "$1"
}

simulando() {
  [ "$SIMULAR" = "1" ]
}

fallar_paso() {
  fallar "No se ha podido $1. Lo que ha pasado está en $CARPETA/logs/instalacion.log. Vuelve a pegar el mismo comando."
}

# Lo que se haría: «+ comando». Lo de verdad: el comando, con su salida en el registro.
correr() {
  if simulando; then
    printf '+ %s\n' "$*"
    return 0
  fi
  printf '\n+ %s\n' "$*" >>"$REGISTRO_SERVIDOR"
  "$@" </dev/null >>"$REGISTRO_SERVIDOR" 2>&1
}

# Una línea con tuberías o redirecciones. Solo lleva valores ya comprobados (dominio, carpeta).
correr_sh() {
  if simulando; then
    printf '+ %s\n' "$1"
    return 0
  fi
  printf '\n+ %s\n' "$1" >>"$REGISTRO_SERVIDOR"
  bash -o pipefail -c "$1" </dev/null >>"$REGISTRO_SERVIDOR" 2>&1
}

# Un comando como el usuario crm, dentro de la carpeta del CRM y con el Node.js del CRM delante.
como_crm() {
  if simulando; then
    printf '+ runuser -u crm -- env HOME=%s PATH=%s/.herramientas/node/bin:$PATH npm_config_update_notifier=false NEXT_TELEMETRY_DISABLED=1 %s\n' "$CASA_CRM" "$CARPETA" "$*"
    return 0
  fi
  printf '\n+ (crm) %.300s\n' "$*" >>"$REGISTRO_SERVIDOR"
  (cd "$CARPETA" && runuser -u crm -- env HOME="$CASA_CRM" PATH="$CARPETA/.herramientas/node/bin:$PATH" \
    npm_config_update_notifier=false NEXT_TELEMETRY_DISABLED=1 "$@") </dev/null >>"$REGISTRO_SERVIDOR" 2>&1
}

# Igual, pero con un texto en la entrada estándar (que nunca va al registro).
como_crm_con_entrada() {
  local entrada="$1"
  shift
  printf '\n+ (crm) %s\n' "$*" >>"$REGISTRO_SERVIDOR"
  printf '%s\n' "$entrada" | (cd "$CARPETA" && runuser -u crm -- env HOME="$CASA_CRM" PATH="$CARPETA/.herramientas/node/bin:$PATH" "$@") >>"$REGISTRO_SERVIDOR" 2>&1
}

# Al salir, el detalle se suma a {carpeta}/logs/instalacion.log. Si el usuario crm ya existe, lo
# escribe él; si aún no existe, nadie más ha podido tocar la carpeta y lo escribe root.
terminar_servidor() {
  if [ -n "$REGISTRO_SERVIDOR" ] && [ -f "$REGISTRO_SERVIDOR" ]; then
    if id crm </dev/null >/dev/null 2>&1; then
      if [ -d "$CARPETA" ] && [ ! -L "$CARPETA" ]; then
        (cd "$CARPETA" && runuser -u crm -- bash -c 'mkdir -p logs && cat >>logs/instalacion.log') <"$REGISTRO_SERVIDOR" >/dev/null 2>&1
      fi
    else
      mkdir -p "$CARPETA/logs" && cat "$REGISTRO_SERVIDOR" >>"$CARPETA/logs/instalacion.log"
    fi
    rm -f "$REGISTRO_SERVIDOR"
  fi
  if [ -n "$TEMPORAL_SERVIDOR" ] && [ -d "$TEMPORAL_SERVIDOR" ]; then
    rm -rf "$TEMPORAL_SERVIDOR"
  fi
}

leer_opciones_servidor() {
  local patron='^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
  while [ $# -gt 0 ]; do
    case "$1" in
      --servidor)
        shift
        if [ $# -eq 0 ] || [ -z "$1" ] || [ "${1#--}" != "$1" ]; then
          fallar "Falta el dominio. Escríbelo así: --servidor crm.tunegocio.com"
        fi
        DOMINIO="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
        ;;
      --simular) SIMULAR=1 ;;
      *) fallar "No conozco la opción $1." 2 ;;
    esac
    shift
  done
  [ -n "$DOMINIO" ] || fallar "Falta el dominio. Escríbelo así: --servidor crm.tunegocio.com"
  if [ "${#DOMINIO}" -gt 253 ] || ! [[ "$DOMINIO" =~ $patron ]]; then
    fallar "$DOMINIO no es un dominio válido. Escríbelo sin https:// ni barras, como crm.tunegocio.com."
  fi
}

# La carpeta va en el servicio de systemd y en comandos de root: solo letras, números y . _ - /.
elegir_carpeta_servidor() {
  local patron='^/[A-Za-z0-9._/-]+$'
  CARPETA="${CRM_DIR:-/opt/crm-whatsapp}"
  CARPETA="${CARPETA%/}"
  case "$CARPETA" in
    /*/*) ;;
    *) fallar "CRM_DIR tiene que ser una carpeta propia del CRM, como /opt/crm-whatsapp." ;;
  esac
  case "$CARPETA" in
    *..* | *//*) fallar "CRM_DIR tiene que ser una carpeta propia del CRM, como /opt/crm-whatsapp." ;;
  esac
  [[ "$CARPETA" =~ $patron ]] || fallar "CRM_DIR tiene que ser una carpeta propia del CRM, como /opt/crm-whatsapp."
}

comprobar_administrador() {
  if simulando; then
    printf '+ comprobaría que se ejecuta como administrador (root)\n'
    return 0
  fi
  if [ "${EUID:-$(id -u </dev/null)}" != "0" ]; then
    fallar "Hace falta ser administrador. Vuelve a pegar el comando con sudo delante de bash: curl -fsSL $INSTALADOR_URL | sudo bash -s -- --servidor $DOMINIO"
  fi
}

comprobar_sistema() {
  local id version maquina
  maquina="$(uname -m </dev/null 2>/dev/null)"
  if simulando; then
    printf '+ comprobaría que el sistema es Ubuntu 24.04 (/etc/os-release)\n'
    printf '+ comprobaría la arquitectura con uname -m (x86_64 → x64, aarch64 → arm64)\n'
    case "$maquina" in
      aarch64 | arm64) ARQUITECTURA="arm64" ;;
      *) ARQUITECTURA="x64" ;;
    esac
    return 0
  fi
  id="$(sed -n 's/^ID=//p' /etc/os-release 2>/dev/null </dev/null | tr -d '"' | head -n 1)"
  version="$(sed -n 's/^VERSION_ID=//p' /etc/os-release 2>/dev/null </dev/null | tr -d '"' | head -n 1)"
  if [ "$id" != "ubuntu" ] || [ "$version" != "24.04" ]; then
    aviso "Probado en Ubuntu 24.04: en este sistema puede fallar algún paso."
  fi
  case "$maquina" in
    x86_64) ARQUITECTURA="x64" ;;
    aarch64) ARQUITECTURA="arm64" ;;
    *) fallar "Este servidor no es de 64 bits (x86_64 o arm64): el instalador no sabe prepararlo." ;;
  esac
}

# ¿Alguna IP de la primera lista está en la segunda?
alguna_coincide() {
  local ip
  for ip in $1; do
    if printf '%s\n' "$2" | grep -Fxq "$ip"; then
      return 0
    fi
  done
  return 1
}

comprobar_dns() {
  local del_dominio propias publica
  if simulando; then
    printf '+ comprobaría que %s apunta a este servidor: getent ahostsv4 %s frente a ip -4 -o addr show scope global y, si no coincide, curl -4 -fsS --max-time 5 https://api.ipify.org\n' "$DOMINIO" "$DOMINIO"
    return 0
  fi
  del_dominio="$(getent ahostsv4 "$DOMINIO" </dev/null 2>/dev/null | awk '{print $1}' | sort -u)"
  propias="$(ip -4 -o addr show scope global </dev/null 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | sort -u)"
  printf '\nDNS de %s: %s\nIP de este servidor: %s\n' "$DOMINIO" "$(printf '%s' "$del_dominio" | tr '\n' ' ')" "$(printf '%s' "$propias" | tr '\n' ' ')" >>"$REGISTRO_SERVIDOR"
  if alguna_coincide "$propias" "$del_dominio"; then
    return 0
  fi
  publica="$(curl -4 -fsS --max-time 5 https://api.ipify.org </dev/null 2>/dev/null)" || publica=""
  if ! printf '%s' "$publica" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}$'; then
    aviso "No se ha podido saber la IP pública de este servidor: si $DOMINIO no apunta aquí, el certificado HTTPS no llegará."
    return 0
  fi
  printf 'IP pública: %s\n' "$publica" >>"$REGISTRO_SERVIDOR"
  if alguna_coincide "$publica" "$del_dominio"; then
    return 0
  fi
  fallar "$DOMINIO no apunta a este servidor. En tu proveedor de dominio, crea un registro A con $publica y vuelve a ejecutar este comando."
}

# Con menos de 1,9 GB y sin swap, «next build» se queda sin memoria: 2 GB de swap en /swapfile.
preparar_memoria() {
  local kb
  if simulando; then
    printf '+ comprobaría la memoria (/proc/meminfo y /proc/swaps); con menos de 1,9 GB y sin swap:\n'
  else
    kb="$(awk '/^MemTotal:/ {print $2}' /proc/meminfo 2>/dev/null </dev/null)"
    [ -n "$kb" ] && [ "$kb" -lt 1992294 ] || return 0
    [ "$(awk 'NR > 1' /proc/swaps 2>/dev/null </dev/null | wc -l)" -eq 0 ] || return 0
  fi
  if simulando || [ ! -f /swapfile ]; then
    correr fallocate -l 2G /swapfile || fallar_paso "preparar la memoria de intercambio"
  fi
  correr chmod 600 /swapfile && correr mkswap /swapfile && correr swapon /swapfile ||
    fallar_paso "preparar la memoria de intercambio"
  if simulando || ! grep -q '^/swapfile[[:space:]]' /etc/fstab </dev/null 2>/dev/null; then
    correr_sh "printf '/swapfile none swap sw 0 0\\n' >>/etc/fstab" || fallar_paso "preparar la memoria de intercambio"
  fi
}

instalar_paquetes() {
  correr apt-get update || fallar_paso "actualizar la lista de paquetes"
  correr apt-get install -y --no-install-recommends ca-certificates curl gnupg tar gzip ufw \
    debian-keyring debian-archive-keyring apt-transport-https || fallar_paso "instalar los paquetes del sistema"
  preparar_memoria
}

preparar_usuario() {
  if simulando; then
    printf '+ id crm || useradd --system --create-home --home-dir %s --shell /usr/sbin/nologin crm\n' "$CASA_CRM"
  elif ! id crm </dev/null >/dev/null 2>&1; then
    correr useradd --system --create-home --home-dir "$CASA_CRM" --shell /usr/sbin/nologin crm || fallar_paso "crear el usuario crm"
    USUARIO_NUEVO=1
  fi
  if ! simulando && [ -L "$CARPETA" ]; then
    fallar "$CARPETA es un enlace, no una carpeta: usa otra con CRM_DIR."
  fi
  if [ -d "$CARPETA" ] && [ ! -L "$CARPETA" ]; then
    # Si el usuario es nuevo, nadie más ha podido dejar nada dentro: se le da todo. Si no, solo la carpeta.
    if [ "$USUARIO_NUEVO" = "1" ]; then
      correr chown -R -h crm:crm "$CARPETA" || fallar_paso "preparar la carpeta $CARPETA"
    else
      correr chown -h crm:crm "$CARPETA" || fallar_paso "preparar la carpeta $CARPETA"
    fi
    correr chmod 750 "$CARPETA" || fallar_paso "preparar la carpeta $CARPETA"
  else
    correr mkdir -p "$(dirname "$CARPETA")" &&
      correr install -d -o crm -g crm -m 750 "$CARPETA" || fallar_paso "preparar la carpeta $CARPETA"
  fi
}

# La misma regla de actualización que en un Mac (descargar_en), ejecutada por el usuario crm.
descargar_servidor() {
  local fuente="${CRM_TARBALL:-$URL_TARBALL}"
  local funciones
  if ! simulando && [ -f "$SERVICIO" ]; then
    SERVICIO_EXISTIA=1
  fi
  # Archivos nuevos y una compilación con «next start» en marcha lo rompen: se para antes de copiar.
  if [ "$SERVICIO_EXISTIA" = "1" ]; then
    correr systemctl stop crm-whatsapp || fallar_paso "parar el CRM para actualizarlo"
  elif simulando; then
    printf '+ si el servicio crm-whatsapp ya existe: systemctl stop crm-whatsapp\n'
  fi
  case "$fuente" in
    http://* | https://*) ;;
    *)
      # Un archivo local: una copia que el usuario crm pueda leer.
      if ! simulando; then
        TEMPORAL_SERVIDOR="$(mktemp -d)" && chmod 755 "$TEMPORAL_SERVIDOR" &&
          cp "$fuente" "$TEMPORAL_SERVIDOR/crm.tar.gz" </dev/null >/dev/null 2>&1 &&
          chmod 644 "$TEMPORAL_SERVIDOR/crm.tar.gz" || fallar_paso "descargar el CRM"
        fuente="$TEMPORAL_SERVIDOR/crm.tar.gz"
      fi
      ;;
  esac
  if simulando; then
    como_crm "descargar_en $CARPETA  (bajaría $fuente y lo copiaría archivo a archivo sin tocar .env, .env.local, agente.md, datos/, copias/, logs/ ni tus archivos de negocios/)"
    return 0
  fi
  funciones="$(declare -f ok fallar volver volver_fin limpiar protegido descargar_en)"
  como_crm env MODO=descarga URL_TARBALL="$URL_TARBALL" CRM_TARBALL="$fuente" \
    bash -c "set -u; TEMPORAL=''; $funciones"'
trap limpiar EXIT; descargar_en "$1"' descargar_en "$CARPETA" || fallar_paso "descargar el CRM"
}

instalar_node() {
  local descarga linea archivo version actual
  if simulando; then
    como_crm curl -fsSL --retry 3 -o '<temporal>/SHASUMS256.txt' "$URL_NODE/SHASUMS256.txt"
    printf '+ tomaría la línea de node-v24.*-linux-%s.tar.gz de SHASUMS256.txt; si %s/.herramientas/node/bin/node -v ya es esa versión, se salta lo que sigue\n' "$ARQUITECTURA" "$CARPETA"
    como_crm curl -fsSL --retry 3 -o "<temporal>/node-v24.X.Y-linux-$ARQUITECTURA.tar.gz" "$URL_NODE/node-v24.X.Y-linux-$ARQUITECTURA.tar.gz"
    como_crm "sha256sum -c -  (en <temporal>, con esa línea de SHASUMS256.txt: si no coincide, se para todo)"
    como_crm rm -rf .herramientas/node.nuevo
    como_crm mkdir -p .herramientas/node.nuevo
    como_crm tar -xzf "<temporal>/node-v24.X.Y-linux-$ARQUITECTURA.tar.gz" --strip-components=1 -C .herramientas/node.nuevo
    como_crm rm -rf .herramientas/node
    como_crm mv .herramientas/node.nuevo .herramientas/node
    return 0
  fi
  # Lo descargado va a una carpeta temporal del usuario crm: .herramientas/ solo cambia si cambia Node.
  if [ -z "$TEMPORAL_SERVIDOR" ]; then
    TEMPORAL_SERVIDOR="$(mktemp -d)" || fallar_paso "descargar Node.js"
  fi
  descarga="$TEMPORAL_SERVIDOR/node"
  chmod 755 "$TEMPORAL_SERVIDOR" && mkdir -p "$descarga" && chown crm:crm "$descarga" || fallar_paso "descargar Node.js"
  como_crm curl -fsSL --retry 3 -o "$descarga/SHASUMS256.txt" "$URL_NODE/SHASUMS256.txt" || fallar_paso "descargar Node.js"
  linea="$(runuser -u crm -- cat "$descarga/SHASUMS256.txt" </dev/null 2>/dev/null |
    grep -E "^[0-9a-f]{64}  node-v24\.[0-9]+\.[0-9]+-linux-$ARQUITECTURA\.tar\.gz\$" | head -n 1)"
  [ -n "$linea" ] || fallar_paso "descargar Node.js"
  archivo="${linea##* }"
  version="${archivo#node-}"
  version="${version%-linux-*}"
  actual="$(cd "$CARPETA" && runuser -u crm -- .herramientas/node/bin/node -v </dev/null 2>/dev/null)" || actual=""
  printf '\nNode.js: %s (había: %s)\n' "$version" "${actual:-ninguno}" >>"$REGISTRO_SERVIDOR"
  [ "$actual" = "$version" ] && return 0
  como_crm curl -fsSL --retry 3 -o "$descarga/$archivo" "$URL_NODE/$archivo" || fallar_paso "descargar Node.js"
  # La comprobación con SHASUMS256.txt: si no coincide, se para todo.
  como_crm_con_entrada "$linea" bash -c "cd '$descarga' && sha256sum -c -" ||
    fallar_paso "comprobar Node.js: la descarga no coincide con SHASUMS256.txt"
  como_crm rm -rf .herramientas/node.nuevo &&
    como_crm mkdir -p .herramientas/node.nuevo &&
    como_crm tar -xzf "$descarga/$archivo" --strip-components=1 -C .herramientas/node.nuevo &&
    como_crm rm -rf .herramientas/node &&
    como_crm mv .herramientas/node.nuevo .herramientas/node || fallar_paso "instalar Node.js"
}

preparar_aplicacion() {
  # No hay pnpm global en el servidor: el mismo pnpm que en un Mac sin pnpm.
  como_crm npx --yes pnpm@11.9.0 install --frozen-lockfile || fallar_paso "instalar las piezas del CRM"
  como_crm npx --yes pnpm@11.9.0 exec next build || fallar_paso "preparar la aplicación"
  # Como en un Mac: el asistente de ejemplo solo si aún no hay uno.
  como_crm bash -c '[ -e agente.md ] || [ -L agente.md ] || cp perfiles/reformas.md agente.md' ||
    fallar_paso "preparar la aplicación"
}

# .env solo si falta: el dominio, el puerto, el secreto de las sesiones y el código de alta.
escribir_env() {
  local secreto contenido
  if simulando; then
    if [ -e "$CARPETA/.env" ] || [ -L "$CARPETA/.env" ]; then
      printf '.env ya existe: no se toca.\n'
      return 0
    fi
    printf '%s\n' "+ SESION_SECRETO: head -c 32 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=\n'"
    printf '%s\n' "+ CODIGO_ALTA: head -c 512 /dev/urandom | LC_ALL=C tr -dc 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' | cut -c1-8"
    como_crm "bash -c 'umask 077; set -C; cat >.env'  (# comentario, CRM_DOMINIO=$DOMINIO, PUERTO=3000, SESION_SECRETO=\"…\", CODIGO_ALTA=\"…\"; permisos 600, dueño crm)"
    PRIMERA_VEZ=1
    CODIGO="<código de alta>"
    return 0
  fi
  if [ -e "$CARPETA/.env" ] || [ -L "$CARPETA/.env" ]; then
    printf '\n.env ya existe: no se toca.\n' >>"$REGISTRO_SERVIDOR"
    return 0
  fi
  secreto="$(head -c 32 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=\n')"
  CODIGO="$(head -c 512 /dev/urandom | LC_ALL=C tr -dc 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' | cut -c1-8)"
  if [ "${#secreto}" -lt 40 ] || [ "${#CODIGO}" -ne 8 ]; then
    fallar_paso "crear las claves del CRM"
  fi
  contenido="# Modo servidor: lo ha escrito instalar.sh --servidor. Las claves de Claude y WhatsApp se pegan en el panel.
CRM_DOMINIO=$DOMINIO
PUERTO=3000
SESION_SECRETO=\"$secreto\"
CODIGO_ALTA=\"$CODIGO\""
  como_crm_con_entrada "$contenido" bash -c 'umask 077; set -C; cat >.env && chmod 600 .env' ||
    fallar_paso "escribir la configuración del CRM (.env)"
  PRIMERA_VEZ=1
}

instalar_caddy() {
  local llave="/usr/share/keyrings/caddy-stable-archive-keyring.gpg"
  local lista="/etc/apt/sources.list.d/caddy-stable.list"
  local guardado="/etc/caddy/Caddyfile.antes-del-crm"
  correr_sh "curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --batch --yes --dearmor -o $llave" &&
    correr_sh "curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt >$lista" &&
    correr chmod o+r "$llave" "$lista" &&
    correr apt-get update &&
    correr apt-get install -y caddy || fallar_paso "instalar Caddy (HTTPS)"
  # Un Caddyfile que no es el del paquete ni el nuestro se guarda aparte.
  if simulando; then
    printf '+ si /etc/caddy/Caddyfile no es el del paquete ni el del CRM: mv /etc/caddy/Caddyfile %s\n' "$guardado"
  elif [ -f /etc/caddy/Caddyfile ] &&
    ! head -n 1 /etc/caddy/Caddyfile </dev/null | grep -q '^# crm-whatsapp:' &&
    ! grep -q 'The Caddyfile is an easy way to configure your Caddy web server' /etc/caddy/Caddyfile </dev/null; then
    [ -e "$guardado" ] && guardado="$guardado.$(date +%Y%m%d%H%M%S)"
    correr mv /etc/caddy/Caddyfile "$guardado" || fallar_paso "configurar Caddy (HTTPS)"
    aviso "Ya había una configuración de Caddy: la he guardado en $guardado."
  fi
  correr_sh "runuser -u crm -- cat $CARPETA/scripts/servidor/Caddyfile | sed 's/__DOMINIO__/$DOMINIO/g' >/etc/caddy/Caddyfile" ||
    fallar_paso "configurar Caddy (HTTPS)"
  if simulando; then
    printf '+ systemctl reload caddy  (restart si no está en marcha)\n'
  elif systemctl is-active --quiet caddy </dev/null; then
    correr systemctl reload caddy || fallar_paso "poner en marcha Caddy (HTTPS)"
  else
    correr systemctl restart caddy || fallar_paso "poner en marcha Caddy (HTTPS)"
  fi
}

instalar_servicio() {
  correr_sh "runuser -u crm -- cat $CARPETA/scripts/servidor/crm-whatsapp.service | sed 's#__CARPETA__#$CARPETA#g' >$SERVICIO" &&
    correr systemctl daemon-reload || fallar_paso "preparar el servicio del CRM"
  if [ "$SERVICIO_EXISTIA" = "1" ]; then
    correr systemctl enable crm-whatsapp && correr systemctl restart crm-whatsapp || fallar_paso "arrancar el CRM"
  else
    correr systemctl enable --now crm-whatsapp || fallar_paso "arrancar el CRM"
  fi
}

# Los puertos de SSH, también uno cambiado: con sshd (ss) o con ssh.socket (Ubuntu 24.04).
puertos_ssh() {
  {
    ss -Htlnp </dev/null 2>/dev/null | awk '/"sshd"/ {print $4}' | sed 's/.*://'
    systemctl show -p Listen --value ssh.socket </dev/null 2>/dev/null | grep -oE ':[0-9]+ \(Stream\)' | sed 's/^://; s/ .*//'
  } | grep -E '^[0-9]+$' | sort -un
}

abrir_cortafuegos() {
  local puerto
  correr ufw allow 22/tcp || fallar_paso "abrir el cortafuegos"
  if simulando; then
    printf '+ ufw allow <puerto>/tcp  (cada puerto de SSH: ss -Htlnp con "sshd" y ssh.socket)\n'
  else
    for puerto in $(puertos_ssh); do
      if [ "$puerto" != "22" ] && [ "$puerto" -ge 1 ] && [ "$puerto" -le 65535 ]; then
        correr ufw allow "$puerto/tcp" || fallar_paso "abrir el cortafuegos"
      fi
    done
  fi
  correr ufw allow 80/tcp && correr ufw allow 443/tcp && correr ufw --force enable || fallar_paso "abrir el cortafuegos"
}

esperar_crm() {
  if correr curl -fsS --max-time 10 --retry 30 --retry-delay 4 --retry-all-errors -o /dev/null "https://$DOMINIO/api/estado?solo=firma"; then
    ok "CRM en marcha"
  else
    aviso "El CRM está instalado, pero https://$DOMINIO aún no responde. Espera unos minutos y ábrelo; si sigue igual, mira qué dice: sudo journalctl -u caddy -n 50"
  fi
}

servidor() {
  set -o pipefail
  leer_opciones_servidor "$@"
  elegir_carpeta_servidor
  export DEBIAN_FRONTEND=noninteractive
  if simulando; then
    printf 'Simulación: se escriben los pasos y no se ejecuta nada.\n'
    printf '+ export DEBIAN_FRONTEND=noninteractive\n'
  fi
  comprobar_administrador
  if ! simulando; then
    REGISTRO_SERVIDOR="$(mktemp)" || fallar "No se ha podido empezar: no hay sitio en /tmp."
    trap terminar_servidor EXIT
    printf '\n=== instalar.sh --servidor %s · %s ===\n' "$DOMINIO" "$(date '+%Y-%m-%d %H:%M:%S')" >>"$REGISTRO_SERVIDOR"
  fi
  comprobar_sistema
  comprobar_dns
  ok "Servidor comprobado"
  instalar_paquetes
  preparar_usuario
  descargar_servidor
  ok "Descargado"
  instalar_node
  ok "Node.js listo"
  preparar_aplicacion
  ok "Aplicación preparada"
  escribir_env
  instalar_caddy
  instalar_servicio
  abrir_cortafuegos
  ok "HTTPS y cortafuegos listos"
  esperar_crm
  if [ "$PRIMERA_VEZ" = "1" ]; then
    printf 'Listo: abre https://%s/entrar y usa el código de alta %s\n' "$DOMINIO" "$CODIGO"
  else
    printf 'Listo: tu CRM está actualizado en https://%s\n' "$DOMINIO"
  fi
}

# --servidor va por su propio camino y nunca llega a los pasos de la instalación en un Mac.
pide_servidor() {
  local opcion
  for opcion in "$@"; do
    [ "$opcion" = "--servidor" ] && return 0
  done
  for opcion in "$@"; do
    [ "$opcion" = "--simular" ] && fallar "--simular solo funciona junto a --servidor."
  done
  return 1
}

main() {
  if pide_servidor "$@"; then
    servidor "$@"
    exit 0
  fi
  leer_opciones "$@"
  elegir_carpeta
  comprobar_node
  comprobar_cerrado
  trap limpiar EXIT
  if [ "$MODO" = "descarga" ]; then
    descargar_en "$CARPETA"
    ok "Descargado"
  fi
  ok "Node.js listo"
  preparar
  ok "Aplicación preparada"
  escribir_lanzador
  [ "$ARRANCAR" = "1" ] || exit 0
  printf 'Abriendo tu CRM en el navegador… Deja esta ventana abierta; para pararlo, Ctrl+C\n'
  cd "$CARPETA" || exit 1
  exec bash arrancar.sh </dev/null
}

main "$@"
