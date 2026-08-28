# Independent authorization-shape DATA review

## Finding

Confirmed strict type/schema divergence, **not an authorization bypass**.
Exactly eight presealed expectations were exercised once: seven matched; A02 did not.
`readAuthorization` accepted a single-element array commit and returned it unchanged.
No readiness GO, root grant, provider acceptance or broader executor verdict is given.

## Immutable inputs and scope

- Candidate: `230ed3c6e15617b312760367adf9ede4e5c7ff6a`.
- Supplied evidence: `fedfca3c445696a19aaf84ac85bc74cff229d5c2`.
- Supplied recipe: `05aa8dce295c507fd605c93aa113ba2ecd5605064dc0f6dfe3a20aa6dc6bf04d`.
- Current own-data TYPES/keys/order/no-coercion policy: `f5fa0d3fa03532860bad120bf1a71a1b0af3caaa`.
- Preseal commit: `1b467df7fb4b006df7b98b4e91d252269da6050c`.
- `PRESEAL.json` SHA-256: `bb0a3687536561c716e9d9be54e15fcd3ded86350386fca7baf04f74f2ea22b5`.
- Owned changes are exclusively beneath this report's directory; candidate/peer/history stayed read-only.

`PRESEAL.json` fixes the actual source/helper hashes, static import audit and harness hash.
`EXPECTATIONS.json` fixes all eight ordered expectations and exact fixture file hashes.
The 15 listed files matched both candidate and then-current committed HEAD before sealing.
The supplied recipe/evidence identifiers are context, not a packet-authentication claim.
All AUTH files are JSON DATA, <=2 KiB, mode 0644, beneath owned `runs/paths/`.
They use all-zero 40-hex commits, all-zero 64-hex hashes and nonexistent reference paths.
They are schema fixtures, **not usable root grants**; neither reference was resolved.
A02-A07 change only `review`; the corresponding `grant` stays canonical.

## Static safety and caller inspection

The complete static closure contains 13 modules, plus one import-time JSON data file.
`executor-v5/consumer-scope.mjs` reads/parses its local `CONSUMER-SCOPES.json` at import.
Other initialization creates bindings, path constants and frozen profile data only.
No import-time execution reaches engine/comparator source, spawning, networking or staging.
`node:child_process` is statically imported; its dormant `authority` spawn is never called.
Only the actual `authorization.mjs` module was explicitly imported after the preseal commit.
Only its `readAuthorization` export was called; no copied/extracted implementation was used.

Static locations relative to `tests/comparison/breadth-continuation-20260828/`:
- `executor-v7-r1/authorization.mjs:21`: commit regex lacks a preceding string-type guard.
- That line guards path with `typeof`; sha256 uses the type-checking `hashString` helper.
- `executor-v7/schema.mjs:1`: `dataObject` enforces own-data keys, not field value types.
- `executor-v7-r1/production.mjs:26`: caller forwards returned review/grant unchanged.
- `executor-v7-r1/authorization.mjs:59`: dormant caller uses `${binding.commit}:${binding.path}`.

Inference from static code and A02: regex coercion admits this single-string array.
The caller's interpolation may still identify the same immutable commit after coercion.
No Git lookup of either reference or actual grant call tested that downstream behavior.

## Exact outcomes

| ID | Presealed expectation | Actual | Match |
| --- | --- | --- | --- |
| A01 | Canonical string references accepted | Accepted, unchanged | yes |
| A02 | Single-element array commit rejected | Accepted, array retained | **no** |
| A03 | Numeric commit `0` rejected | AUTH_REFERENCE_SCHEMA | yes |
| A04 | Array path rejected | AUTH_REFERENCE_SCHEMA | yes |
| A05 | Array sha256 rejected | AUTH_REFERENCE_SCHEMA | yes |
| A06 | Extra reference key rejected | AUTH_REFERENCE_SCHEMA | yes |
| A07 | Missing reference key rejected | AUTH_REFERENCE_SCHEMA | yes |
| A08 | Top-level array rejected | AUTH_FILE_SCHEMA | yes |

## Execution and preservation

One run: `2026-08-28T14:54:15.602Z` through `2026-08-28T14:54:15.619Z`.
Runtime: Node `v22.22.2`, Darwin arm64, `--unhandled-rejections=strict`; exit 1 records A02.
`runs/RESULTS.json` preserves all returns/errors and before/after source/input snapshots.
Evidence SHA-256: `3bb0028bf8ffeb3688181be7eb36021a1f451d24ac0cd1e51bc41a044e1851c7`.
Authorization SHA-256 before **and** after:
`bf0c0d1dc58a634606c16911b7ffd82ef0259ac963463bd1020f9796ecca1bd1`.
All 15 listed source/data/caller files and ten harness/fixture inputs stayed identical.
No fatal or integrity error; both nonexistent reference paths remained absent.
Checks cover listed paths, not append-proof trees or arbitrary concurrent mutation.
Syntax checking and owned-path whitespace checks passed; no broad suite was run.
No engines, comparator, admission/cohort/C11/native/network/staging/XAN or peer cases ran.
No children, subprocess tests, eval, VM, grant minting, source patch or rebaseline occurred.
Git metadata and explicit-path commits were used; commit hooks were disabled per invocation.
These eight JSON fixtures do not establish general type/key/order or cross-realm coverage.
Parent integration remains separate; no additional case or rerun is authorized by this report.
