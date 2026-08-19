#!/bin/sh
set -eu
if ! command -v node >/dev/null 2>&1; then
  echo "Paycheck requires Node.js 22 or newer from https://nodejs.org/"
  exit 1
fi
(sleep 1; if command -v open >/dev/null 2>&1; then open "http://localhost:4173/"; elif command -v xdg-open >/dev/null 2>&1; then xdg-open "http://localhost:4173/"; fi) >/dev/null 2>&1 &
exec node "$(dirname "$0")/run-local.mjs"
