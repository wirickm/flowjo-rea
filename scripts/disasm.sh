#!/usr/bin/env bash
# Disassemble one exported function of FlowJo's native engine by demangled name.
# Requires ./scripts/fetch-flowjo.sh to have run.
# Usage: ./scripts/disasm.sh 'Logicle::transform(double) const'
set -euo pipefail
DIR="${FLOWJO_RE_DIR:-/tmp/fjre}"
LIB="$DIR/x/FlowJo 11.app/Contents/Resources/app.asar.unpacked/out/main/libNativeEngine.dylib"
SYMS="$DIR/engine-symbols.txt"
name="$1"
start=$(grep -F " $name" "$SYMS" | grep -E '^[0-9a-f]+ T ' | head -1 | cut -d' ' -f1)
[[ -n "$start" ]] || { echo "Symbol not found: $name" >&2; exit 1; }
# Function end = next text symbol address.
next=$(awk -v s="$start" '$2 ~ /^[Tt]$/ && $1 > s && (m == "" || $1 < m) {m = $1} END {print m}' "$DIR/engine-symbols-all.txt")
llvm-objdump -d --demangle --no-show-raw-insn \
  --start-address=0x"$start" --stop-address=0x"${next:-$start}" "$LIB"
