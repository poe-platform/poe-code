# Independent snapshot-rmdir verifier

This leaf owns only this new subtree. Production, contracts, original tests,
author evidence, root exports, dependencies and shared `dist` are read-only.
The verifier is not the S3 or wrapper source author. See `REPORT.md` for the
bounded findings, negative results, source identities and provenance limits.

## Execution

From the repository root, the executions retained here were:

```sh
node tests/fs/s3/rmdir-independent/run.mjs
node tests/fs/s3/rmdir-independent/run.mjs --service
node tests/fs/s3/rmdir-independent/primary-audit.mjs
node --test --test-reporter=tap tests/fs/s3/rmdir-independent/audit.test.mjs
```

The first command produced `evidence-jgwdUq`: all original cohorts matched,
but two new verifier assumptions failed (22/24). No service was downloaded or
launched. The corrected second command produced `evidence-onRW9e`, including
24/24 independent checks and one authenticated 20-observation MinIO run.
Do not merge their denominators or overwrite either directory.

`run.mjs` always uses production commit
`04879692a66d88eee129b8ffd6e7ca93c7a9476a`, not current HEAD or shared `dist`.
It archives committed inputs, builds only in its newly created owned directory,
replays original assertions byte-for-byte, packs the build, creates a differently
named consumer package boundary, and audits loaded emitted module bytes.
Its `--service` option downloads exactly the locked historical Darwin ARM64
binary into its own scratch directory; no automatic fallback/version search is
implemented. The retained invocation downloaded it once. Running that command
again would be another download and service execution, not an offline audit.

`audit.test.mjs` is the inexpensive offline reproduction of the retained proof:
seven tests, no network, dependency install, service launch or shared build.
`primary-audit.mjs` fetches two primary documents/source files and the official
pinned Git tree; it does not download a service binary. Its initial schema and
quoted-phrase mistakes are retained alongside its corrected result.

Existing local Node/tsx/TypeScript tooling is reused, never installed. The source
and packed product are frozen, but the entire development dependency tree is not
vendored. Actual runtime URLs are historical execution receipts, not paths that
are expected to survive cleanup. Native HTTP captures preserve their CRLF and
bytes; do not normalize evidence to satisfy a whitespace checker.
