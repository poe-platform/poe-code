# Isolated reference tooling qualification — 2026-09-18

This continuation preserves the existing fourteen-command engine, registrations,
historical native captures, unrelated edits and staging. Its implementation scope
is the previously missing reusable native tooling and docs/csvkit/coverage.json.
It does not complete the user's requested all-input csvkit compatibility suite.

The explicit tooling checks were added and run failing first, then implemented.
Subsequent malformed-capture, locale/buffering, executable-authentication and
inventory-retention regressions also failed before their fixes. Final explicit
in-memory checks pass 12/12 with no native execution, network, on-disk test files
or database use; the filesystem cases use memfs. Tooling strict NodeNext
typecheck and tooling ESLint pass. These checks are deliberately outside
canonical unit discovery and product exports.

Maintained uncached checks:

| Route | Result | Qualification |
| --- | --- | --- |
| `npm test --workspace=@poe-code/csvkit` | 94 files, 4,355 passes, one skip, five TODOs | Current domain regression assertions; refusals/skips/TODOs are not native parity passes |
| `npm run lint --workspace=@poe-code/csvkit` | Exit 0 | Maintained source ESLint and product/test TypeScript checks |
| `npm run build:workspaces -- --workspace=@poe-code/csvkit` | Exit 0, four declared builds | office-package, safe-fs, safe-python and csvkit closure, uncached |
| Explicit reference checks and strict tooling typecheck | Exit 0 | Tooling only |
| Tooling ESLint from packages/csvkit | Exit 0 | New reference tooling only |
| Explicit coverage regeneration | Deterministic byte hash | Inventories, not product compatibility |

The full repository unit/release gate was not rerun: no shared infrastructure,
workspace membership, registration, integration input or product export was
changed in this continuation. Prior repository-gate failures remain recorded
in implementation-status.md and are not superseded by the focused checks.
No rendered CLI behavior changed, so no visual qualification is claimed.

The generated ledger retains 14 original names, 415 options, 323 branches,
159 parser declarations, 394 upstream files, 14,817 test declarations and
52 static assignments. Original command overrides/groups/defaults/help,
branch mappings, file hashes, collection caveats, test blockers and static
assignments remain available. All unauthenticated declaration-to-case mappings
are unresolved. Qualified mappings remain zero; this does not erase earlier
measured behavior or imply those features are wholly absent.

Final deterministic coverage SHA-256:
`cd32a17376421a3e9ff2f404f13f7a9f48cabff9cdd19aa697e4f14072e60b4a`.

## Native prerequisite evidence

The explicit native-only probe was invoked with the minimal frozen environment
and `/Users/kjopek/.local/share/uv/python/cpython-3.14.2-macos-aarch64-none/bin/python3.14`.
The runtime executable/version/platform, locale and pipe metadata match the
narrow frozen prerequisite check. The installation contains only pip, whose
installed manifest also differs. Qualification fails every frozen distribution
requirement: agate, agate-dbf, agate-excel, agate-sql, babel, csvkit, dbfread,
et_xmlfile, isodate, leather, olefile, openpyxl, parsedatetime, pip,
python-slugify, pytimeparse, SQLAlchemy, text-unidecode, typing_extensions and
xlrd. The frozen csvkit executable/dependency installation is unavailable to
this invocation. No csvkit case was executed or compared through the new runner.
The runner's native end-to-end success path therefore remains unmeasured.

Raw native inspection SHA-256 before reduction/purge:
`31b35d069b2166279dfca170dfb4ac13d586adba37c357176f499bb1b1156cbb`.
This is prerequisite evidence, not an input/output oracle or compatibility pass.
No newer installation, implicit PATH lookup or Python product fallback was used.

The runner's profile qualification covers pinned interpreter/script bytes,
installed distribution manifests, locale and pipe stream metadata. It does
not qualify native linkage/compression versions, driver/service transactions,
workbook structured semantics, PTY/IPython, controlled timings or native
signal/buffering equivalence. Those remain blocked/unmeasured explicitly.
The existing engine's other documented language/codec/diagnostic blockers remain.

## Independent safe-bash review

A different agent independently ran these existing focused checks from
packages/safe-bash, uncached and serial:

```sh
node --import tsx --test --test-concurrency=1 tests/commands/csvkit-{probe-cleanup-stress,byte-ownership-review,sql-stream-boundary-review,input-lifecycle-user-review,binding-snapshot-stress}.test.ts

node --import tsx --test --test-concurrency=1 tests/commands/csvkit-stress.test.ts tests/commands/in2csv-output-ownership.test.ts tests/commands/csvkit-raw-resource-stress.test.ts tests/commands/csvkit-network-provider-stress.test.ts tests/commands/csvkit-sql-lifecycle-user-review.test.ts
```

All 31 + 94 assertions pass. No concrete defect was reproduced and no binding
fix was made. The review covers all-name collision preflight, retained byte
ownership, backpressure, cancellation provenance, probe/input cleanup barriers,
SQL transaction/session cleanup and sibling side-file ownership during stdout
closure. Explicit status-78 capability refusals are not native parity passes.
Mock transport/cleanup success does not establish real-driver/service support.

Only this continuation's owned native inspection scratch is purged after
reduction. Existing out evidence is preserved. No README addition, staging,
commit, push or publication occurred.
