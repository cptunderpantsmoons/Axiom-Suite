#!/usr/bin/env bash
# =============================================================================
# NTFS native-bin fix (no-root) for Axiom
# -----------------------------------------------------------------------------
# Root cause: the project lives on an NTFS3-mounted drive (ntfs3 kernel driver).
# ANY native code mapped from that mount fails to mmap/dlopenn and crashes or
# errors outright:
#   - Go executables (esbuild -> tsx, vite, vitest): SIGSEGV (exit 139)
#   - native shared addons (rollup's .node, built with Rust): "failed to map
#     segment from shared object" (ERR_DLOPEN_FAILED)
# Node/python/tsc/rustc run from the native root fs (/usr, $HOME), so they work.
#
# No-root fix: npm-install with `--ignore-scripts`, then relocate every native
# ELF binary / .node shared addon under node_modules onto a native Linux
# filesystem ($HOME = ext2/3 here) and symlink each back. The OS resolves the
# symlink to the native target, so mmap/dlopen succeed.
#
# Usage:
#   scripts/ntfs-native-bins.sh [pkg-dir ...]    # from repo root
#   scripts/ntfs-native-bins.sh /abs/path/to/pkg
# A package is installed with --ignore-scripts first if node_modules is absent.
# Re-run after any `npm install` that (re)installs a native dep.
# =============================================================================
set -euo pipefail

BASE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STORE="${AXIOM_NATIVE_STORE:-$HOME/.cache/axiom/native-bins}"
mkdir -p "$STORE"

if [ "$#" -gt 0 ]; then DIRS=("$@"); else DIRS=(packages/axiom-core app); fi

# ELF magic: 0x7f 'E' 'L' 'F'
is_elf() { head -c 4 "$1" | od -An -tx1 | grep -q "7f 45 4c 46"; }

reloc() {
  local bin="$1"
  [ -L "$bin" ] && return 0          # already a symlink to native
  is_elf "$bin" || return 0          # not a native ELF -> leave JS files alone
  local key target
  key="$(printf '%s' "$bin" | sha256sum | cut -c1-16)"
  target="$STORE/$key-$(basename "$bin")"
  if [ ! -e "$target" ]; then cp "$bin" "$target"; fi
  rm -f "$bin"
  ln -s "$target" "$bin"
  echo "  relocated: ${bin#"$BASE"/} -> $target"
}

for d in "${DIRS[@]}"; do
  case "$d" in
    /*) pkg="$d" ;;         # absolute path
    *)  pkg="$BASE/$d" ;;   # repo-relative (default: packages/core app)
  esac
  [ -d "$pkg" ] || { echo "skip: no dir $pkg"; continue; }
  echo "== ${pkg#"$BASE"/} =="

  if [ ! -d "$pkg/node_modules" ]; then
    echo "  installing (--ignore-scripts)..."
    (cd "$pkg" && npm install --ignore-scripts --no-audit --no-fund 2>&1 | tail -2)
  fi

  found=0
  # 1) native shared addons (*.node) — rollup, etc.
  while IFS= read -r -d '' f; do found=1; reloc "$f"; done \
    < <(find "$pkg/node_modules" -type f -name '*.node' -print0 2>/dev/null || true)
  # 2) native executables shipped in @esbuild/*/bin (Go binaries)
  while IFS= read -r -d '' f; do found=1; reloc "$f"; done \
    < <(find "$pkg/node_modules/@esbuild" -type f -path '*/bin/*' -print0 2>/dev/null || true)

  [ "$found" -eq 0 ] && echo "  (no native binaries found)"
done

echo
echo "Done. Native executables/addons now resolve to $STORE (native fs)."
echo "Re-run after any npm install that reinstalls a native dependency."