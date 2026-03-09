#!/usr/bin/env bash
set -euo pipefail

echo "[cre-build] Host preflight diagnostics"
uname -a || true
ldd --version || true

npm run prepare:cre:sim-assets

WORKFLOW_STAGE_DIR="./.cre/workflows/event-microinsurance"
if [ ! -f "$WORKFLOW_STAGE_DIR/.cre_build_tmp.js" ]; then
  echo "[cre-build] Missing $WORKFLOW_STAGE_DIR/.cre_build_tmp.js"
  echo "[cre-build] Generate workflow bundle locally and commit it before deploying."
  echo "[cre-build] Suggested command:"
  echo "[cre-build]   cd workflows && cre workflow build ./event-microinsurance --target staging-settings"
  exit 1
fi

# Keep hosted bundle under serverless size limits.
rm -rf "$WORKFLOW_STAGE_DIR/node_modules"
rm -rf "$WORKFLOW_STAGE_DIR/test"
rm -rf "$WORKFLOW_STAGE_DIR/test-payloads"
rm -f "$WORKFLOW_STAGE_DIR/bun.lock"
rm -f "$WORKFLOW_STAGE_DIR/package-lock.json"

export PATH="$HOME/.cre:$HOME/.cre/bin:$HOME/.local/bin:$PATH"

CRE_VERSION_CANDIDATES=(v1.3.0 v1.2.0 v1.1.0 v1.0.10)
CRE_ATTEMPTS=()
CRE_LIBSTDCXX_URLS=(
  "https://anaconda.org/conda-forge/libstdcxx-ng/12.2.0/download/linux-64/libstdcxx-ng-12.2.0-h46fd767_19.tar.bz2"
)
CRE_LAST_VERIFY_ERROR=""
CRE_LIBSTDCPP_READY="false"
CRE_NEEDS_EXTRA_LIBSTDCPP="false"
CRE_EXTRA_LD_LIBRARY_PATH=""

log() {
  echo "[cre-build] $*" >&2
}

record_attempt() {
  CRE_ATTEMPTS+=("$*")
  log "$*"
}

ensure_bun_runtime() {
  local bun_bin
  bun_bin="$(command -v bun || true)"

  if [ -z "$bun_bin" ]; then
    record_attempt "Installing Bun runtime for hosted TypeScript workflow compilation"
    if ! curl -fsSL https://bun.sh/install | bash; then
      record_attempt "Bun installer command failed"
      return 1
    fi
    export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
    export PATH="$BUN_INSTALL/bin:$PATH"
    bun_bin="$(command -v bun || true)"
  fi

  if [ -z "$bun_bin" ] && [ -x "$HOME/.bun/bin/bun" ]; then
    bun_bin="$HOME/.bun/bin/bun"
  fi

  if [ -z "$bun_bin" ]; then
    record_attempt "Bun runtime not found after installation"
    return 1
  fi

  mkdir -p ./.cre/bin
  cp "$bun_bin" ./.cre/bin/bun
  chmod +x ./.cre/bin/bun
  log "Bundled Bun runtime: $(./.cre/bin/bun --version)"
  return 0
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

run_cre_version() {
  local candidate="$1"
  local output_file="$2"

  if [ -n "$CRE_EXTRA_LD_LIBRARY_PATH" ]; then
    LD_LIBRARY_PATH="${CRE_EXTRA_LD_LIBRARY_PATH}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
      "$candidate" version >"$output_file" 2>&1
    return $?
  fi

  "$candidate" version >"$output_file" 2>&1
}

verify_cre_bin() {
  local candidate="$1"
  local output_file
  CRE_LAST_VERIFY_ERROR=""
  output_file="$(mktemp)"
  if run_cre_version "$candidate" "$output_file"; then
    cat "$output_file" >&2
    rm -f "$output_file"
    return 0
  fi

  local compact
  compact="$(tr '\n' ' ' <"$output_file" | sed 's/[[:space:]]\+/ /g')"
  CRE_LAST_VERIFY_ERROR="$compact"
  record_attempt "Binary execution failed at $candidate :: $compact"
  rm -f "$output_file"
  return 1
}

ensure_libstdcpp_runtime() {
  if [ "$CRE_LIBSTDCPP_READY" = "true" ]; then
    return 0
  fi

  mkdir -p ./.cre/lib
  local temp_dir
  temp_dir="$(mktemp -d)"

  for url in "${CRE_LIBSTDCXX_URLS[@]}"; do
    local archive="${temp_dir}/libstdcxx.tar.bz2"
    record_attempt "Trying libstdc++ runtime package :: $url"

    if ! curl -fL "$url" -o "$archive"; then
      record_attempt "libstdc++ package download failed :: $url"
      continue
    fi

    rm -rf "${temp_dir}/extract"
    mkdir -p "${temp_dir}/extract"
    if ! tar -xjf "$archive" -C "${temp_dir}/extract"; then
      record_attempt "libstdc++ package extraction failed :: $url"
      continue
    fi

    if ! find "${temp_dir}/extract" -type f -name 'libstdc++.so.6*' -exec cp '{}' ./.cre/lib/ ';'; then
      record_attempt "libstdc++ package had no copyable runtime libs :: $url"
      continue
    fi

    if [ ! -f ./.cre/lib/libstdc++.so.6 ]; then
      local versioned
      versioned="$(find ./.cre/lib -maxdepth 1 -type f -name 'libstdc++.so.6.*' | head -n1 || true)"
      if [ -n "$versioned" ]; then
        ln -sf "$(basename "$versioned")" ./.cre/lib/libstdc++.so.6
      fi
    fi

    if [ -f ./.cre/lib/libstdc++.so.6 ]; then
      CRE_EXTRA_LD_LIBRARY_PATH="$(pwd)/.cre/lib"
      CRE_LIBSTDCPP_READY="true"
      record_attempt "Installed libstdc++ runtime fallback at ${CRE_EXTRA_LD_LIBRARY_PATH}"
      rm -rf "$temp_dir"
      return 0
    fi
  done

  rm -rf "$temp_dir"
  record_attempt "Unable to install compatible libstdc++ runtime package"
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

  if [[ "$CRE_LAST_VERIFY_ERROR" == *"GLIBCXX_3.4.30"* ]]; then
    if ensure_libstdcpp_runtime && verify_cre_bin "$HOME/.cre/bin/cre"; then
      rm -rf "$temp_dir"
      CRE_NEEDS_EXTRA_LIBSTDCPP="true"
      CRE_SELECTED_BIN="$HOME/.cre/bin/cre"
      return 0
    fi
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

if ! ensure_bun_runtime; then
  log "Failed to prepare Bun runtime required for hosted TypeScript simulation."
  exit 1
fi

mkdir -p ./.cre/bin
if [ "$CRE_NEEDS_EXTRA_LIBSTDCPP" = "true" ]; then
  cp "$CRE_BIN" ./.cre/bin/cre.real
  chmod +x ./.cre/bin/cre.real
  cat > ./.cre/bin/cre <<'WRAPPER'
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$SCRIPT_DIR/../lib"
if [ -d "$LIB_DIR" ]; then
  export LD_LIBRARY_PATH="$LIB_DIR${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi
exec "$SCRIPT_DIR/cre.real" "$@"
WRAPPER
  chmod +x ./.cre/bin/cre
else
  cp "$CRE_BIN" ./.cre/bin/cre
  chmod +x ./.cre/bin/cre
fi
./.cre/bin/cre version

npm run build
