#!/usr/bin/env bash
set -euo pipefail

npm run prepare:cre:sim-assets

curl -fsSL https://cre.chain.link/install.sh | bash
export PATH="$HOME/.cre:$HOME/.cre/bin:$HOME/.local/bin:$PATH"

CRE_BIN="$(command -v cre || true)"
if [ -z "$CRE_BIN" ] && [ -x "$HOME/.cre/cre" ]; then
  CRE_BIN="$HOME/.cre/cre"
fi
if [ -z "$CRE_BIN" ] && [ -x "$HOME/.cre/bin/cre" ]; then
  CRE_BIN="$HOME/.cre/bin/cre"
fi
if [ -z "$CRE_BIN" ] && [ -x "$HOME/.local/bin/cre" ]; then
  CRE_BIN="$HOME/.local/bin/cre"
fi
if [ -z "$CRE_BIN" ]; then
  echo "CRE CLI install failed: cre binary not found"
  exit 1
fi

mkdir -p ./.cre/bin
cp "$CRE_BIN" ./.cre/bin/cre
chmod +x ./.cre/bin/cre
./.cre/bin/cre version

npm run build
