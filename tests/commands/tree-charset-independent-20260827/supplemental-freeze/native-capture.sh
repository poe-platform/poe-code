#!/bin/sh
set -eu

: "${TREE_NATIVE:?absolute pinned native tree executable required}"
: "${TREE_NATIVE_SHA256:?expected executable SHA-256 required}"
: "${TREE_NATIVE_OUT:?new output directory required}"

case "$TREE_NATIVE" in /*) ;; *) echo "TREE_NATIVE must be absolute" >&2; exit 2;; esac
test -x "$TREE_NATIVE" || { echo "native executable is not executable" >&2; exit 2; }
test ! -e "$TREE_NATIVE_OUT" || { echo "output already exists" >&2; exit 2; }

actual=$(shasum -a 256 "$TREE_NATIVE" | awk '{print $1}')
test "$actual" = "$TREE_NATIVE_SHA256" || { echo "native hash mismatch" >&2; exit 2; }

mkdir -p "$TREE_NATIVE_OUT/fixture/alpha/leaf" "$TREE_NATIVE_OUT/fixture/omega"
printf '%s\n' "$TREE_NATIVE" >"$TREE_NATIVE_OUT/executable.path"
printf '%s\n' "$actual" >"$TREE_NATIVE_OUT/executable.sha256"
uname -a >"$TREE_NATIVE_OUT/uname.txt"
sw_vers >"$TREE_NATIVE_OUT/sw_vers.txt"
"$TREE_NATIVE" --version >"$TREE_NATIVE_OUT/version.stdout" 2>"$TREE_NATIVE_OUT/version.stderr"

run_case() {
  id=$1
  shift
  set +e
  env -i "$@" >"$TREE_NATIVE_OUT/$id.stdout" 2>"$TREE_NATIVE_OUT/$id.stderr"
  status=$?
  set -e
  printf '%s\n' "$status" >"$TREE_NATIVE_OUT/$id.status"
}

run_case ascii-flag "$TREE_NATIVE" --charset ASCII "$TREE_NATIVE_OUT/fixture"
run_case utf8-flag "$TREE_NATIVE" --charset UTF-8 "$TREE_NATIVE_OUT/fixture"
run_case utf8-noscore-flag "$TREE_NATIVE" --charset UTF8 "$TREE_NATIVE_OUT/fixture"
run_case lowercase-utf8-flag "$TREE_NATIVE" --charset utf8 "$TREE_NATIVE_OUT/fixture"
run_case unknown-flag "$TREE_NATIVE" --charset definitely-unknown "$TREE_NATIVE_OUT/fixture"
run_case tree-over-lc TREE_CHARSET=UTF-8 LC_ALL=C "$TREE_NATIVE" "$TREE_NATIVE_OUT/fixture"
run_case lc-all LC_ALL=C LC_CTYPE=en_US.UTF-8 LANG=en_US.UTF-8 "$TREE_NATIVE" "$TREE_NATIVE_OUT/fixture"
run_case lc-ctype LC_CTYPE=en_US.UTF-8 LANG=C "$TREE_NATIVE" "$TREE_NATIVE_OUT/fixture"
run_case lang LANG=en_US.UTF-8 "$TREE_NATIVE" "$TREE_NATIVE_OUT/fixture"
run_case lowercase-locale-extension LANG=en_US.utf8 "$TREE_NATIVE" "$TREE_NATIVE_OUT/fixture"
run_case empty-tree TREE_CHARSET= LC_ALL=en_US.UTF-8 "$TREE_NATIVE" "$TREE_NATIVE_OUT/fixture"
run_case unknown-tree TREE_CHARSET=definitely-unknown LC_ALL=en_US.UTF-8 "$TREE_NATIVE" "$TREE_NATIVE_OUT/fixture"

find "$TREE_NATIVE_OUT" -type f -maxdepth 1 -print0 | sort -z | xargs -0 shasum -a 256 >"$TREE_NATIVE_OUT/captures.sha256"
