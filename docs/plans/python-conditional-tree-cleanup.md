# Python temporary-directory cleanup (#749)

## Validated failure

The installed standalone candidate containing #751 reproduces the issue with
pinned Pyodide 314.0.6: TemporaryDirectory creates its contents, then CPython's
descriptor-safe rmtree fails opening a retained directory with ENOTSUP.
Evidence: `/tmp/poe-749-delivery-reproduction.log`.

## Implementation

- Use the issue's explicitly permitted capability-selected cleanup alternative.
- Add `atomicTreeRemoval` and `removeTreeConditional(path, { parent, expected,
  signal })`; never infer this capability from ordinary recursive `rm`.
- Memory compares the original directory and parent identities and performs
  permission preflight and removal without an asynchronous interleaving point.
- Preserve symlink targets, retained file handles, quota enforcement, readonly
  policy, operation admission, cancellation, and mount boundaries.
- Python selects this backend operation only when supported. Keep CPython's
  descriptor-safe implementation for other cases; do not turn off its global
  symlink-attack protection or claim generic `dir_fd` support.

## Required evidence and remaining qualification

- Focused tests for replacement races, retained resources, cancellation,
  readonly/quota/scoped/mount wrappers and unsupported capability refusal.
- Real Python: normal and exceptional TemporaryDirectory exit, nested contents,
  symlink confinement, cleanup callbacks, and awaited worker retirement on
  memory, delayed, quota, and mount compositions.
- Qualify intended remote adapters separately. A delayed memory proxy is not
  deployed remote-backend proof, and safe refusal is not successful cleanup.
- Validate installed package exports, types, scoped lint and CLI-visible errors.
- Commit owned files, verify remote main, and monitor package publication.

## Verified local milestone

- Standalone real-Pyodide cleanup passes for all four selected adapters.
- The existing document workflow passes on memory, delayed, quota and
  quota-delayed storage. Its required cleanup TODO is now an asserted pass;
  delayed qualification reports zero outstanding handles.
- 231 Python tests (including 36 independent cleanup stress tests), 70 focused
  filesystem tests, and 261 composition/regression tests pass.
- Maintained source/types and all 26 public consumer groups pass; guarded
  ESLint reports zero errors. The CLI startup/output screenshot was inspected.
- These results do not qualify generic `dir_fd` or deployed remote cleanup.
