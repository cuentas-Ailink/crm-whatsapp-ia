#!/usr/bin/env bash
# Abre el CRM y lo deja en marcha hasta Ctrl+C.
# Uso: bash arrancar.sh (o doble clic en «Abrir CRM»)

cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  printf '\033[31mERROR\033[0m  Falta Node.js. Sigue los pasos de INSTALAR.md y ejecuta: bash instalar.sh\n'
  exit 1
fi

exec node scripts/arrancar.mjs
