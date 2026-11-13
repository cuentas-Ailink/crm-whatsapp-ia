#!/usr/bin/env bash
# Lista de OK / AVISO / ERROR de tu CRM abierto. Cada ERROR dice qué hacer.
# Uso, con el CRM abierto: bash comprobar.sh (con --arreglar, además arregla lo que se puede arreglar solo)

cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  printf '\033[31mERROR\033[0m  Falta Node.js. Sigue los pasos de INSTALAR.md y ejecuta: bash instalar.sh\n'
  exit 1
fi

exec node scripts/comprobar.mjs "$@"
