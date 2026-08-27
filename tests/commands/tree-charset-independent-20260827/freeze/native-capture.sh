#!/bin/sh
set -eu

: "${TREE_NATIVE:?set TREE_NATIVE to the pinned native tree executable}"
: "${TREE_NATIVE_SHA256:?set TREE_NATIVE_SHA256 to its expected SHA-256}"
: "${TREE_NATIVE_OUT:?set TREE_NATIVE_OUT to a new output directory}"

test ! -e "$TREE_NATIVE_OUT" || { echo "output already exists" >&2; exit 2; }
actual=$(shasum -a 256 "$TREE_NATIVE" | awk '{print $1}')
test "$actual" = "$TREE_NATIVE_SHA256" || { echo "native hash mismatch" >&2; exit 2; }
mkdir -p "$TREE_NATIVE_OUT/fixture/alpha" "$TREE_NATIVE_OUT/fixture/omega"
"$TREE_NATIVE" --version >"$TREE_NATIVE_OUT/version.stdout" 2>"$TREE_NATIVE_OUT/version.stderr"
printf '%s\n' "$actual" >"$TREE_NATIVE_OUT/executable.sha256"
LC_ALL=C "$TREE_NATIVE" --charset ASCII "$TREE_NATIVE_OUT/fixture" >"$TREE_NATIVE_OUT/ascii.stdout" 2>"$TREE_NATIVE_OUT/ascii.stderr"
LC_ALL=C "$TREE_NATIVE" --charset UTF-8 "$TREE_NATIVE_OUT/fixture" >"$TREE_NATIVE_OUT/utf8.stdout" 2>"$TREE_NATIVE_OUT/utf8.stderr"
shasum -a 256 "$TREE_NATIVE_OUT"/*.stdout "$TREE_NATIVE_OUT"/*.stderr >"$TREE_NATIVE_OUT/captures.sha256"
