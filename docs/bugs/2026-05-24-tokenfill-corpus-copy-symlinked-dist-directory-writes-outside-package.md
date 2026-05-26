# Tokenfill corpus copy follows a symlinked dist directory and writes outside the package

## Summary

The `tokenfill` package corpus copy script copies its runtime corpus beneath the fixed `dist/corpus` output path without rejecting a symbolic link at the package `dist` directory. A symlinked parent output directory redirects corpus assets outside the package.

## Reproduction

1. From the repository root, run this disposable package-fixture probe:

   ```sh
   probe=$(mktemp -d /tmp/poe-tokenfill-parent-probe.XXXXXX)
   mkdir -p "$probe/pkg/scripts" "$probe/pkg/src/corpus" "$probe/outside"
   cp packages/tokenfill/scripts/copy-corpus.mjs "$probe/pkg/scripts/"
   printf 'TOKEN CONTENT\n' > "$probe/pkg/src/corpus/probe.txt"
   ln -s "$probe/outside" "$probe/pkg/dist"

   (cd "$probe/pkg" && node scripts/copy-corpus.mjs)

   realpath "$probe/pkg/dist"
   cat "$probe/outside/corpus/probe.txt"
   ```

## Observed Behavior

The apparent package `dist` directory resolves externally, and invoking the corpus copy creates `corpus/probe.txt` beneath the external target containing `TOKEN CONTENT`.

`packages/tokenfill/scripts/copy-corpus.mjs:5` through `packages/tokenfill/scripts/copy-corpus.mjs:8` derive the fixed package corpus destination, and `packages/tokenfill/scripts/copy-corpus.mjs:10` recursively copies through it without canonical-containment or symlink checks.

## Expected Behavior

Corpus asset copying should write only beneath the canonical `tokenfill` package `dist` directory. A symlinked package output root escaping the package should be rejected.

## Impact

A crafted checkout or stale package build symlink can make routine corpus packaging create or overwrite external runtime-data files with developer or CI privileges.
