#!/usr/bin/env bash
# Fetch third-party reference fixtures into fixtures/ (gitignored).
# FlowKit (BSD-3-Clause, Scott White) ships FlowJo-saved .wsp files with
# FlowJo-computed population counts, a FlowJo biex lookup table, and the
# ISAC Gating-ML 2.0 compliance data set with per-event truth membership.
set -euo pipefail
cd "$(dirname "$0")/.."
FLOWKIT_COMMIT=f2159043b6a56e527d4baacf97490caf8354618e
dest=fixtures/flowkit
if [ -d "$dest/.git" ] && [ "$(git -C "$dest" rev-parse HEAD)" = "$FLOWKIT_COMMIT" ]; then
  echo "fixtures/flowkit already at $FLOWKIT_COMMIT"; exit 0
fi
rm -rf "$dest"
git init -q "$dest"
git -C "$dest" remote add origin https://github.com/whitews/FlowKit.git
git -C "$dest" fetch -q --depth 1 origin "$FLOWKIT_COMMIT"
git -C "$dest" checkout -q FETCH_HEAD
echo "fetched FlowKit $FLOWKIT_COMMIT into $dest"
