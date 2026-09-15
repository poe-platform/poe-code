# DOCX scoped acceptance verification

Reviewed on 2026-09-15 against root instructions, the shared CLI/SDK contracts,
the DOCX specification, both upstream audits and complete retained inventories.
Baseline local main was `f891de08b`; unrelated dirty files and the empty index
were preserved. This is bounded verification, not whole-format acceptance.

## Validated correction

Fresh built Shell destination probes returned exit 1 and preserved source and
sentinel bytes, but reported only `Document operation failed: conflict`.
The original small memfs regression then failed twice on missing recovery text,
after its status, envelope and preservation assertions passed. See
[red evidence](conflict-red.log). No product code changed before that failure.

The generic conflict diagnostic now advises reviewing input/destination state,
choosing a new output path, or using `--in-place` only for intentional input
replacement. It retains code/status, bounded diagnostics, null error data, zero
effects and publication rules. It never recommends bypassing validation with
force and never echoes document content. Fresh built retries show a new proposed
destination succeeds and rejected destinations remain unchanged.

## Checks and actual observations

- `npm test --workspace=docx`: 178 files, 3,438 passed tests, four skipped.
  [Maintained result](unit-green.log). The preceding baseline run passed 177
  files and 3,436 tests with the same four skips.
- Installed focused Vitest run: all five existing/owned usability regression
  files passed, 12 tests. [Result](focused-green.log). After fixing a require-yield
  lint issue in the owned test's unexpected-stdin guard, the two original memfs
  cases passed again: [result](conflict-green.log).
- `npm run lint --workspace=docx` passed; one existing type-only-variable warning
  remains at operation-types.test.ts:20. [Result](lint.log).
- `npm run build:workspaces -- --workspace=docx` passed the declared five-build
  closure, including portable safe-fs and built-export smoke checks.
  [Result](build.log). No native document engine was admitted.
- `npm run test:schemas --workspace=docx` failed its setup prerequisite because
  `DOCX_SCHEMA_ROOT` was absent. [Result](schemas.log). Its independent validator
  bootstrap invoked the native xmllint version probe; no schema case executed,
  and no native document runtime, schema acquisition or network fallback followed.
  These ten unexecuted cases are not passes. This opt-in independent route is
  separate from the maintained canonical unit suite.
- Agent-executed built Shell probes used `/work` MemoryFileSystem, bounded
  streams/limits and original authored inputs. [Baseline observations](observations.json)
  retain common edits, B2 reads, advanced property-batch rollback, discovery and
  destination refusals. [Fresh recovery observations](recovery-observations.json)
  retain exact commands/results and source/sentinel hashes.
- Previously unrun Q23 JSON-before-`--`, Q28 existing/alias destinations,
  Q18 semantic rollback, Q32 stale/re-list/fresh-token retry and Q43 ordered
  missing-selector recovery were exercised. Q32 preserves the post-intervention
  package; fresh tokens differ and the retry succeeds. Original merged B2 still
  rejects without mutation. These small inputs do not repeat every rich-fixture
  variant in the historical receipt.
- Q27 binary creation and subsequent stdin text extraction each returned 0;
  the combined built Shell pipe returned 0 with no banner mixed into binary
  data. Individual statuses inside the combined pipeline remain unobserved.
- Maintained `npm run screenshot` executed built image-replacement help with
  explicit limits and succeeded. Its maintained terminal-png renderer also
  rendered captured built Shell help/errors. Root introduction, image/cell help,
  legacy/schema errors, original/new conflict errors and stale/ambiguous errors
  were visually inspected under `screenshots/docx-verification-20260915`.
  Screenshots remain disposable and uncommitted. Root discovery leads with
  concise flag-based workflows; detailed help exposes selectors and limits.
  This is terminal inspection, not document rendering or fixed-width layout QA.

## Evidence limits and exact mappings

The prior five correction commits and their tests/procedure were inspected:
`5de4bd53c`, `d2d99dbf0`, `ddf6791db`, `adb633b6a`, `f11606f11`.
The historical raw CLI receipt retains their original observed defects and two
fresh extraction/ambiguity results. The procedure records failing assertions
and green totals; separate raw red unit logs for those five improvements were
not supplied in that receipt. Their original red executions were not freshly
certified by this review. Current focused tests verify their current behavior.

[Inventory review](inventory-review.json) retains hashes, every existing exact
JS/security mapping, neutral error categories and all 23 documentation-drift
decisions. The 920 unique API records, 262 enum values, 11 enum type aliases,
1,337 target rows, 1,609 source unit variants and 650 BDD cases remain research
accounting. Historical unmapped statuses were not promoted by CLI/unit passes.
Inherited members, public underscore-prefixed/returned types, helpers,
collections and APIs without upstream tests remain obligations.

Model names stay neutral snake_case; operation options use camelCase. Admission,
save and external byte loading are always async; admitted model access is sync.
Model sequences are checked zero-based length/iterator/at surfaces with only
declared slices; CLI ordinals are one-based and fingerprinted. Keyed lookups,
null/false/zero/empty values and nullable reads versus writes stay distinct.
Units use safe integer EMUs and half-away rounding (914400/in, 360000/cm,
36000/mm, 12700/pt, 635/twip). UTC Date copying/whole-second normalization is
distinct from utility timestamp strings; Uint8Array data is owned. Image sizing
uses per-axis DPI/72 fallback, compatibility SHA-1 and evidence SHA-256.
Owner-bound XML/package views permit no evaluation, external resolution,
ambient host resources or native document runtime. No model aliases, helpers or
private exclusions were introduced.

All PPTX agent counterparts, injected source/sink/publication failures,
cancellation, repeated/ambiguous template expansion, exhaustive model API,
large/publisher corpus and application rendering remain unrun in this review.
Historical observations remain separately scoped; no unavailable QA passed.
No publisher bytes or cloned binaries were acquired or owned for cleanup.

QA setup errors were corrected without product changes: the first memfs adapter
lacked staging hooks ([setup failure](conflict-setup-failure.log)); an overbroad
focused-test invocation was cancelled and replaced with installed focused
Vitest; the separate Node REPL could not resolve a workspace dependency; a
hand-entered PNG was refused; the first maintained screenshot lacked engine
limits. None is the validated diagnostic red evidence or a successful QA case.

Only the atomic conflict correction, its original test and relevant plan/evidence
are delivered locally. No README edit, push, release or broad staging occurred.
