# safe-bash-diff-engine

Portable shared helpers for Safe Bash. Uses injected filesystem and stream contracts without host filesystem access.

`IndexedDocument` in `safe-bash-diff-engine/document` stages byte sources with
bounded byte and line-index caches. Line equality checks hashes and then exact
bytes; range replay emits at most 16 KiB per block, including arbitrarily long
lines. Storage spills only through the injected safe-fs under `TMPDIR` or `cwd`.
Call `close()` on every outcome. Memory-backed safe-fs stores spilled data in RAM;
choose an external backend for large workloads.
For many live documents, supply a shared `PagedStorageCache` as
`budget.documentCache`. Byte and index pages share that aggregate budget, and
documents omit their separate line/comparison caches.
