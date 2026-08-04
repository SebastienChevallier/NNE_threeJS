#!/bin/sh
# Double-clic (macOS) ou exécution (Linux) pour installer les dépendances et
# lancer l'éditeur. Requiert Node.js >= 22 et pnpm (npm install -g pnpm).
set -e
cd "$(dirname "$0")"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm est introuvable. Installe-le d'abord :"
  echo "  npm install -g pnpm"
  echo "puis relance ce fichier."
  read -r _ 2>/dev/null || true
  exit 1
fi

echo "Installation et lancement de l'éditeur..."
echo "Cette fenêtre doit rester ouverte. Ctrl+C pour arrêter."
echo

pnpm run start
