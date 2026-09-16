# DOCX test baseline verification

Task: `verify-python-test-baseline` only. Completed 2026-09-14 as documentation
and retained-evidence verification, with raw-artifact limitations recorded.
Branch: `main`. Local commit only; no push or release.

## Owned scope

- `docs/docx/upstream-test-audit.md`
- `docs/docx/upstream-baseline-verification.json`
- This task record.

Root AGENTS.md applies; no scoped AGENTS.md exists under `docs`. Read the DOCX
and shared Office CLI/SDK specifications, both test audits/inventories/evidence,
and the DOCX API audit, inventory and reconciliation. Existing modifications to
`docs/plans/docx-typescript-safe-bash.md` and the unrelated plan move are excluded
from ownership. This record carries completion without staging that edited plan.
No README, product source, test implementation, dependency or fixture is changed.

## Agent QA procedure and results

1. Inspect branch, status and index. Confirm main and an initially empty staging
   area; preserve unrelated work. Inspect the existing reference checkout without
   resetting it. Compare actual file bytes against pinned HEAD, rather than
   trusting its empty index. Result: all 625 tracked files match; zero mismatches.
2. Parse both retained test inventories and evidence files in full. Compare commit
   values, declared/actual counts, unique unit node IDs and BDD identities
   (`source_file`, line, expanded name). Check source paths/line ranges and sum
   all per-file covered/missing/excluded line and branch counts. Results: DOCX
   1,609 unit variants, 650 examples, 67 features, 95 coverage files; counterpart
   2,700 variants, 973 examples, 54 features, 101 coverage files. All reconcile.
3. Check availability before claiming raw-artifact hashes verified. Result:
   all six original raw artifacts per format are absent. Retain their original
   hashes and failure/pass summaries; do not replace them with invented logs.
   Counterpart source files exist, but Git metadata is absent. No fresh
   counterpart source-pin verification is claimed.
4. Verify DOCX API source/documentation hashes and accounting. Result: 39 RST,
   45 source and one auxiliary hashes match; 920 unique records and 23 existing
   documentation/source resolutions. All DOCX API records and all 2,259 test
   rows remain unmapped. Use the existing exact JS/security decisions; no
   public member is removed because tests omit it or its type begins with `_`.
5. Establish documentary failure before editing. A read-only Node assertion for
   `../pptx/upstream-test-audit.md` in the DOCX test audit failed with
   `AssertionError: DOCX test audit lacks required counterpart crosslink`.
   Add the missing crosslink, shared-behavior comparison and evidence limits.
   This is documentary red/green evidence, not a product TDD test. Failing
   original in-memory tests must precede product code in its owning later task.
6. Check receipt input hashes, crosslinks, unchanged original evidence and case
   statuses; rerun the failed crosslink assertion. Run the repository-maintained
   formatter scoped to the three owned paths with
   `npm exec --no -- prettier --check`, then `git diff --check`. Inspect the
   explicit index before committing and verify the resulting local file list.
   Product build/unit/CLI screenshot checks do not apply to this documentation
   change and are not reported as passes.

Final checks passed: receipt input SHA-256 values, local Markdown links,
crosslink red-to-green assertion, per-directory case counts, cited shared source
paths, and byte-for-byte preservation of the original DOCX evidence and both
DOCX inventories against HEAD. Scoped Prettier and `git diff --check` passed.
The local commit hash and post-commit ownership check are reported at delivery.

## Conditional reproduction procedure

No suite rerun occurred: the pinned DOCX source and retained results are
consistent. Missing disposable raw artifacts reduce auditability but do not
establish changed test results. If source or evidence changes, first record the
discrepancy, source commit and environment. Use an isolated Python 3.11.13
virtualenv with pytest 8.4.2, pyparsing 3.2.3, coverage 7.16.0, behave 1.3.3,
lxml 6.1.3 and Pillow 12.3.0, plus the pinned project's test requirements.
Verify the resolved environment before running; never add it to product dependencies.

Run from the existing pinned checkout with that environment's interpreter:
`python -m pytest tests --cov=docx --cov-branch --cov-report=json --junitxml=... -q`
using explicit invocation-owned artifact destinations. Record actual collected
node IDs without changing execution. Separately run
`python -m behave --format progress --tags=-wip` and retain expanded example
identities and feature/scenario/step pass/fail/skip counts. Keep BDD outside unit
coverage. Do not patch reference source or suppress warnings to force success.

Preserve the initial dependency history: pyparsing 3.3.2 with pytest 9.1.1 caused
35 DOCX collection errors; pyparsing 3.2.3 with pytest 9.1.1 exposed nine setup
errors. The successful pinned versions yielded 1,609 unit passes and 650 BDD
passes, with 7,407/7,612 statement and 884/996 branch coverage, 240 excluded
lines, and 1,856 BDD steps. New evidence must supplement, not erase, this history.

## Remaining work

All later tasks, including `map-all-upstream-tests` and
`reconcile-upstream-contract`, remain pending. No test-case map or product code
was created. The latter task retains the known DOCX specification wording fixes
for adaptation authority, `allowEmpty` and exact text-match cardinality; this task
does not silently adopt the stale alternatives over the shared contracts.

Temporary reference binaries and downloaded documents remain disposable QA
inputs, never shipped or canonical unit dependencies. Nothing was deleted.
Before fixture cleanup, reduce meaningful behavior into original deterministic
in-memory tests in the owning implementation tasks. Retain provenance and any
required standalone MIT notices; reference identities belong only in research,
plans and legally required notices.
