#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${NIPUX_REPO_URL:-https://github.com/Nipux/nipux-local-ai.git}"
INSTALL_DIR="${NIPUX_APP_DIR:-$HOME/.nipux-local-ai/app}"

if ! command -v bun >/dev/null 2>&1; then
  echo "Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi

if ! command -v git >/dev/null 2>&1; then
  echo "git is required. Install git and re-run this script."
  exit 1
fi

if [ ! -d "$INSTALL_DIR/.git" ]; then
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone "$REPO_URL" "$INSTALL_DIR"
else
  git -C "$INSTALL_DIR" pull --ff-only
fi

cd "$INSTALL_DIR"
bun install
bun run setup

echo
echo "Start dev mode:"
echo "  cd $INSTALL_DIR && bun run dev"
echo
echo "Start production mode after llama.cpp is running:"
echo "  cd $INSTALL_DIR && bun run start"
