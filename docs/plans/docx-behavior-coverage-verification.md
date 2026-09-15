# DOCX behavior and coverage verification

Task: `behavior-and-coverage-audit` verification only, 2026-09-15.
Result: partial audit evidence; acceptance remains open. No product correction.

## Ownership and procedure

Root and scoped safe-bash AGENTS.md, DOCX and shared Office specifications,
public API audit/inventory/reconciliation, historical command and API maps,
original fixture coverage, prior packing/discovery plans and actual table
red/green logs were inspected. No scoped docx/docs AGENTS.md exists.

Only this new plan and `docs/docx/behavior-coverage-audit.json` are owned.
All initial changes, index entries, downloaded fixtures and historical evidence
remain intact. Product logic/adapters/exports, README and pipeline status are
unchanged. No push or release is authorized.

The audit supplement maps F01–F50 and all 1,517 current operation declarations
to feature obligations, original test declarations and explicit operation-literal
crosslinks. All 920 historical public inventory records and 1,337 proposed API
rows remain in the denominator, including inherited members, public underscore
owners, enums, collections, helpers and APIs lacking source tests. Scenario
samples are pointers to inspect, not proof of every variant or live model member.
Missing per-member and complete per-operation acceptance remains a blocking gap.
Exact neutral names and JS/security mappings link to authoritative per-row maps.

Nine additive style default/latent operations are included in the supplement;
the historical 1,508-operation design register is preserved. This resolves their
absence from this current audit without rewriting historical implementation
statuses. Existing model defaults, UTC Date/live-owner versus JSON snapshot,
zero-based SDK versus one-based CLI, Uint8Array/VFS, explicit author/time,
null/inheritance, typed error and fixed-dispatch mappings retain their contracts.

No new product defect was reproduced. Current original removal help and
capability budget/error tests pass, so old recorded failures are neither patched
again nor reported fixed here. No fabricated red test, mirrored assertion,
TODO/skip, native reference build, product networking or ambient product I/O
was introduced. Real future defects require original failing memfs tests before
code. The retained seven table failures and 34-case green log were inspected;
the receipt explicitly admits missing archived red source. Missing historical
native raw logs are not claimed verified.

## Fresh maintained scoped checks

- DOCX `test:unit` with V8 coverage: 170 files, 3,374 passes, no failures.
- Office-package `test:unit`: 46 passes; repeated with coverage to measure its
  own error paths separately from DOCX consumers, rather than treating imported
  execution as complete shared-codec evidence.
- DOCX and office-package maintained lint: passed, including source/test types.
  DOCX reports one existing type-only unused-variable warning.
- `npm run build:workspaces -- --workspace=docx`: passed the declared selected
  dependency closure. No full root build/test/lint pass is claimed.
- Maintained safe-bash reporting wrapper, explicit registration and all 26 DOCX
  command files, `TSX_DISABLE_CACHE=1`: 162 passes, zero skips/TODOs/failures.
  Initial registration-only 17-case coverage was incomplete; the final expanded
  run replaces its scope claim. This is not full virtual-bash npm test.
- `npm run test:schemas --workspace=docx`: prerequisite failure because
  `DOCX_SCHEMA_ROOT` is unset; all ten cases are unverified, not passes. No schema
  downloads or alternate host prerequisite was synthesized.

Raw fresh artifacts remain in `output/docx-verification-20260915`, uncommitted.
The supplement retains their hashes, source/test hashes, all file denominators
and reviewed uncovered paths. Test catalog hashes were checked again before
formatting. Maintained scoped Prettier and owned staged whitespace/ownership
checks must pass before the local commit; hooks remain enabled.

## Measured coverage and acceptance gaps

| Scope                                  | Lines                  | Branches               |
| -------------------------------------- | ---------------------- | ---------------------- |
| DOCX                                   | 13,440/13,836 (97.14%) | 19,048/22,168 (85.93%) |
| Shared codec, union of original suites | 603/655 (92.06%)       | 517/615 (84.07%)       |
| DOCX adapters, Node LCOV               | 95/95 (100%)           | 25/27 (92.59%)         |

Product/shared metrics use Vitest V8/Istanbul. Actual shared file hits from both
runs are merged by Istanbul locations, counting each denominator once. Adapter
Node LCOV has a different line definition and is reported separately.

Shared branches miss 85% by six covered branches. No platform exception or
exclusion is justified. Reviewed genuine gaps include compression init/reset
and truncated-stream statuses, retained ZIP metadata rejection, session malformed
snapshot/overflow, nested table geometry rejection, and XML patch rollback error
paths. Coverage holes alone are not demonstrated product defects.

Full live public API acceptance, complete per-operation supported-edit,
preservation/rejection and failure proofs, schema qualification, packaged public
consumer execution and renderer/repair-warning QA remain open. No new visual
behavior was authored, so no screenshot pass is claimed. Large/downloaded QA
was not rerun or folded into fast unit tasks. Working packing/discovery files
remain outside HEAD; live passes cannot certify their committed delivery.

One atomic documentation improvement may be committed locally on main after
its scoped artifact checks. The pipeline task stays open. Report its local hash
separately from remote delivery and releases, neither of which occurred.
