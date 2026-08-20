#!/usr/bin/env bash
# =============================================================================
# NTFS node_modules fix for Axiom
# -----------------------------------------------------------------------------
# Why: esbuild (and other Go-compiled binaries: tsx, vite, vitest) SIGSEGV when
# executed FROM the NTFS3-mounted project partition (partition driver cannot
# provide the executable mmap semantics Go's runtime needs). Node itself is not
# a Go self-mapper, which is why it works while esbuild does not.
#
# Fix: keep the source files on the NTFS drive, but relocate every package's
# `node_modules` into a NATIVE Linux filesystem ($HOME is ext2/3 here) and
# symlink it back. The Go binaries then execute from a native fs and work.
#
# Usage:
#   scripts/ntfs-fix-node-modules.sh            # fix packages/axiom-core and app/
#   AXIOM_NATIVE_MODULES=/my/other/native scripts/ntfs-fix-node-modules.sh
#   scripts/ntfs-fix-node-modules.sh packages/axiom-core app
# =============================================================================
set -euo pipefail

BASE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NATIVE_BASE="${AXIOM_NATIVE_MODULES:-$HOME/.cache/axiom/native-modules}"

# Default package dirs; override with args (relative to repo root).
if [ "$#" -gt 0 ]; then
  DIRS=("$@")
else
  DIRS=(packages/axiom-core app)
fi

mkdir -p "$NATIVE_BASE"

for d in "${DIRS[@]}"; do
  pkg="$BASE/$d"
  [ -d "$pkg" ] || { echo "skip: $d (no such dir)"; continue; }

  rel="${d%/}"
  target="$NATIVE_BASE/$rel"
  mkdir -p "$target"

  if [ -e "$pkg/node_modules" ] && [ ! -L "$pkg/node_modules" ]; then
    echo "  moving existing $d/node_modules -> native $target"
    cp -a "$pkg/node_modules/." "$target/" 2>/dev/null || true
    rm -rf "$pkg/node_modules"
  fi

  if [ ! -L "$pkg/node_modules" ]; then
    ln -s "$target" "$pkg/node_modules"
  fi

  echo "linked: $d/node_modules -> $target  ($(readlink "$pkg/node_modules"))"
done

echo
echo "Done. Re-run 'npm install' in each package; native binaries now live on a native filesystem."
echo "Native store root: $NATIVE_BASE"