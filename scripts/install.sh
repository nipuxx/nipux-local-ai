#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${NIPUX_REPO_URL:-https://github.com/nipuxx/nipux-local-ai.git}"
INSTALL_DIR="${NIPUX_APP_DIR:-$HOME/.nipux-local-ai/app}"
INSTALL_BROWSERS="${NIPUX_INSTALL_BROWSERS:-1}"

fail() {
  echo "Error: $*" >&2
  exit 1
}

case "$(uname -s 2>/dev/null || echo unknown)" in
  Darwin*) PLATFORM_HINT="macOS" ;;
  Linux*) PLATFORM_HINT="Linux" ;;
  *) PLATFORM_HINT="Unix-like" ;;
esac

if ! command -v bun >/dev/null 2>&1; then
  echo "Installing Bun..."
  if ! command -v curl >/dev/null 2>&1; then
    fail "curl is required to install Bun. Install curl, then re-run this script."
  fi
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
  export PATH="$BUN_INSTALL/bin:$PATH"
fi

if ! command -v bun >/dev/null 2>&1; then
  fail "Bun is still not on PATH. Open a new terminal or add $HOME/.bun/bin to PATH."
fi

if ! command -v git >/dev/null 2>&1; then
  if [ "$PLATFORM_HINT" = "macOS" ]; then
    fail "git is required. Run: xcode-select --install"
  fi
  fail "git is required. Install it with your package manager, for example: sudo apt install git"
fi

if [ ! -d "$INSTALL_DIR/.git" ]; then
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone "$REPO_URL" "$INSTALL_DIR"
else
  git -C "$INSTALL_DIR" pull --ff-only
fi

cd "$INSTALL_DIR"
bun install --frozen-lockfile
bun run setup

echo
echo "Machine capability profile:"
if ! bun run capabilities; then
  echo "Warning: capability profile failed. You can retry later with: bun run capabilities" >&2
fi

echo
echo "Readiness summary:"
if ! bun run ready; then
  echo "Some capabilities still need setup. The app can still start in dev mode or after local model setup." >&2
fi

if [ "$INSTALL_BROWSERS" != "0" ]; then
  echo
  echo "Installing Playwright Chromium for browser agents..."
  if ! bun run browsers:install; then
    echo "Warning: Chromium install failed. Browser agents can be repaired later with: bun run browsers:install" >&2
  fi
fi

echo
echo "Start the local app and managed backends:"
echo "  cd $INSTALL_DIR && bun run local"
echo
echo "Try the UI without a model:"
echo "  cd $INSTALL_DIR && bun run dev"
echo
echo "Review setup any time:"
echo "  cd $INSTALL_DIR && bun run capabilities"
echo "  cd $INSTALL_DIR && bun run ready"
echo "  cd $INSTALL_DIR && bun run setup:actions"
