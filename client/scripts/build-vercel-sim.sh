#!/usr/bin/env bash
set -euo pipefail

echo "[cre-build] Host preflight diagnostics"
uname -a || true
ldd --version || true

npm run prepare:cre:sim-assets

export PATH="$HOME/.cre:$HOME/.cre/bin:$HOME/.local/bin:$PATH"

CRE_VERSION_CANDIDATES=(v1.3.0 v1.2.0 v1.1.0 v1.0.10)
CRE_ATTEMPTS=()

log() {
  echo "[cre-build] $*" >&2
}

record_attempt() {
  CRE_ATTEMPTS+=("$*")
  log "$*"
}

resolve_cre_bin() {
  local cre_bin
  cre_bin="$(command -v cre || true)"
  if [ -n "$cre_bin" ]; then
    printf "%s\n" "$cre_bin"
    return 0
  fi

  for candidate in "$HOME/.cre/cre" "$HOME/.cre/bin/cre" "$HOME/.local/bin/cre"; do
    if [ -x "$candidate" ]; then
      printf "%s\n" "$candidate"
      return 0
    fi
  done

  return 1
}

verify_cre_bin() {
  local candidate="$1"
  local output_file
  output_file="$(mktemp)"
  if "$candidate" version >"$output_file" 2>&1; then
    cat "$output_file" >&2
    rm -f "$output_file"
    return 0
  fi

  local compact
  compact="$(tr '\n' ' ' <"$output_file" | sed 's/[[:space:]]\+/ /g')"
  record_attempt "Binary execution failed at $candidate :: $compact"
  rm -f "$output_file"
  return 1
}

try_official_install() {
  local version="$1"
  record_attempt "Trying official installer for $version"

  if ! curl -fsSL https://cre.chain.link/install.sh | bash -s -- "$version"; then
    record_attempt "Official installer command failed for $version"
    return 1
  fi

  local cre_bin
  cre_bin="$(resolve_cre_bin || true)"
  if [ -z "$cre_bin" ]; then
    record_attempt "Official installer finished but no cre binary found for $version"
    return 1
  fi

  if verify_cre_bin "$cre_bin"; then
    CRE_SELECTED_BIN="$cre_bin"
    return 0
  fi

  return 1
}

try_ldd_fallback_asset() {
  local version="$1"
  local asset_url="https://github.com/smartcontractkit/cre-cli/releases/download/${version}/cre_linux_amd64_ldd2-35.tar.gz"
  local temp_dir
  temp_dir="$(mktemp -d)"
  local archive="${temp_dir}/cre.tar.gz"

  record_attempt "Trying fallback artifact for $version :: $asset_url"

  if ! curl -fL "$asset_url" -o "$archive"; then
    record_attempt "Fallback artifact download failed for $version"
    rm -rf "$temp_dir"
    return 1
  fi

  if ! tar -xzf "$archive" -C "$temp_dir"; then
    record_attempt "Fallback artifact extraction failed for $version"
    rm -rf "$temp_dir"
    return 1
  fi

  local unpacked_bin
  unpacked_bin="$(find "$temp_dir" -type f -name cre -perm -u+x | head -n1 || true)"
  if [ -z "$unpacked_bin" ]; then
    unpacked_bin="$(find "$temp_dir" -type f -name 'cre*' -perm -u+x | head -n1 || true)"
  fi
  if [ -z "$unpacked_bin" ]; then
    record_attempt "Fallback artifact did not contain executable cre binary for $version"
    rm -rf "$temp_dir"
    return 1
  fi

  mkdir -p "$HOME/.cre/bin"
  cp "$unpacked_bin" "$HOME/.cre/bin/cre"
  chmod +x "$HOME/.cre/bin/cre"

  if verify_cre_bin "$HOME/.cre/bin/cre"; then
    rm -rf "$temp_dir"
    CRE_SELECTED_BIN="$HOME/.cre/bin/cre"
    return 0
  fi

  rm -rf "$temp_dir"
  return 1
}

CRE_BIN=""
CRE_SELECTED_BIN=""
for version in "${CRE_VERSION_CANDIDATES[@]}"; do
  if try_official_install "$version"; then
    CRE_BIN="$CRE_SELECTED_BIN"
    break
  fi
  if try_ldd_fallback_asset "$version"; then
    CRE_BIN="$CRE_SELECTED_BIN"
    break
  fi
done

if [ -z "$CRE_BIN" ]; then
  log "CRE CLI install failed after trying all version candidates."
  log "Attempt summary:"
  for item in "${CRE_ATTEMPTS[@]}"; do
    log "  - $item"
  done
  log "Final glibc diagnostics:"
  ldd --version || true
  exit 1
fi

log "Using CRE binary: $CRE_BIN"

mkdir -p ./.cre/bin
cp "$CRE_BIN" ./.cre/bin/cre
chmod +x ./.cre/bin/cre
./.cre/bin/cre version

npm run build
