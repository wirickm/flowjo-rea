#!/usr/bin/env bash
# Download and unpack the public FlowJo 11 macOS installer for interop analysis.
# Nothing is committed to the repo; output goes to $FLOWJO_RE_DIR (default /tmp/fjre).
# Idempotent: re-running skips steps whose output already exists.
#
# Usage:  ./scripts/fetch-flowjo.sh            # x64 build (default, best for llvm tools)
#         FLOWJO_ARCH=arm64 ./scripts/fetch-flowjo.sh
# See docs/reverse-engineering.md for what is inside and how to inspect it.
set -euo pipefail

VERSION="${FLOWJO_VERSION:-11.2.0}"
ARCH="${FLOWJO_ARCH:-x64}"
DIR="${FLOWJO_RE_DIR:-/tmp/fjre}"
URL="https://downloads.bdaccessportal.com/v11/mac/${ARCH}/FlowJo-${VERSION}-${ARCH}.dmg"
DMG="$DIR/dl/FlowJo-${VERSION}-${ARCH}.dmg"
OUT="$DIR/x"
MAIN="$OUT/FlowJo 11.app/Contents/Resources/app.asar.unpacked/out/main"

need() { command -v "$1" >/dev/null 2>&1; }

# 1. Tools (Debian/Ubuntu). p7zip reads the HFS+ DMG; llvm reads Mach-O.
missing=()
need 7z || missing+=(p7zip-full)
need llvm-objdump || missing+=(llvm)
if ((${#missing[@]})); then
  echo "Installing: ${missing[*]}"
  apt-get update -qq && apt-get install -y -qq "${missing[@]}"
fi

# 2. Download (about 420 MB).
mkdir -p "$DIR/dl" "$OUT"
if [[ ! -s "$DMG" ]]; then
  echo "Downloading $URL"
  curl -fSL --retry 4 -o "$DMG.part" "$URL"
  mv "$DMG.part" "$DMG"
fi

# 3. Extract only the FlowJo app resources (skips the BD Access Portal launcher).
if [[ ! -f "$MAIN/libNativeEngine.dylib" ]]; then
  echo "Extracting FlowJo app resources"
  7z x -y -o"$OUT" "$DMG" '*FlowJo*11.app/Contents/Resources/*' >/dev/null || true
fi
[[ -f "$MAIN/libNativeEngine.dylib" ]] || { echo "Extraction failed: $MAIN" >&2; exit 1; }

# 4. Unpack the Electron UI bundle (JavaScript).
ASAR="$OUT/FlowJo 11.app/Contents/Resources/app.asar"
if [[ ! -d "$DIR/asar" ]]; then
  echo "Unpacking app.asar"
  npx --yes @electron/asar@3.2.17 extract "$ASAR" "$DIR/asar"
fi

# 5. Demangled symbol table of the native engine (C++, exported symbols kept).
if [[ ! -s "$DIR/engine-symbols.txt" ]]; then
  llvm-nm -gU --demangle "$MAIN/libNativeEngine.dylib" > "$DIR/engine-symbols.txt"
  llvm-nm --defined-only --demangle "$MAIN/libNativeEngine.dylib" > "$DIR/engine-symbols-all.txt"
fi

cat <<EOF
Ready.
  Engine:   $MAIN/libNativeEngine.dylib
  Symbols:  $DIR/engine-symbols.txt ($(wc -l < "$DIR/engine-symbols.txt") lines)
  UI JS:    $DIR/asar
Disassemble one function, e.g.:
  ./scripts/disasm.sh 'EllipseGate::ContainsPoint(double, double)'
EOF
