# Independent single-fixture review: accepted within scope

Source candidate: `ec59c917ba137126a064960995b5fc6945ea8f6d`.
Baseline and candidate parent: `40fb77fb09a2145e8a767c96b64966dafdff5c2b`.
The exact handoff is retained in `candidate-v1/author-handoff.txt`; its author
claims are not substituted for independent measurements.

## Failure cause and patch audit

The original test intercepts an inferred `RegexExecutor.request` method. The
additive expr overload contextually types that replacement callback's descriptor
as `Descriptor | ExprMatchDescriptor`. Ordinary regex/glob descriptors have
`patterns`; expr has `pattern`, `profile` and `limits`. The unguarded callback
therefore cannot access `patterns` (TS2339), pass the union to regex-only
`inputBytes` (TS2345), or pass it to either correlated bound overload (TS2769).
The latter needs a particular descriptor/result pair, not the unrefined union.
These are exactly the original diagnostics at 54:42, 54:96 and 55:21.

This is a fixture-interception typing incompatibility exposed by the added
overload, not evidence that correctly typed production regex/expr requests or
their runtime protocol regressed. The fixture does not use a generic type
parameter: its former broad inferred method surface lost the correlation needed
by its regex-only instrumentation. The correction explicitly describes that
local regex-only view with `Omit<RegexExecutor, "request">` and a
`Descriptor -> Promise<Match[][]>` method signature. Assignment from the real
executor is checked; this is not a cast or a new universal request API.

The candidate commit changes exactly one canonical file, +4/-2 lines: type-only
imports and that local variable annotation. No production, export, compiler
configuration or other canonical test changes. AST inspection finds no `any`,
type assertion or `as` cast in the candidate fixture, and no suppression
directive. All four test names and all 14 assertion call texts remain exact.
Entire emitted JavaScript equality also covers input cases, batching sizes,
mock forwarding, cleanup and every executable expression—not merely names or
selected assertions. The annotation is safe for this fixture's regex-only use;
it is not claimed to make this interception usable for expr requests.

## Independent results

| Control | Baseline | Exact candidate |
| --- | --- | --- |
| Strict exact fixture/imported closure | TS2339, TS2345, TS2769 only | Zero diagnostics |
| Selected runtime-support closure | Zero diagnostics | Zero diagnostics |
| Unmodified emitted glob tests | 4/4 pass | 4/4 pass |
| Unmodified emitted expr protocol tests | 5/5 pass | 5/5 pass |

The nine unique runtime cases ran on each revision (18 successful test
executions). The expr tests exercise actual workers, reply shape/bounds,
admission limits, capture states, main-thread rejection and mixed legacy/expr
requests. No mock replacement or protocol assertion edits were made.

Both fixture emissions are **4,812 identical bytes**, SHA-256
`b995643979e9447809a8c216768e021e00700c854b3477469a3cfaa57f32e146`.
Baseline emission intentionally proceeds despite the three known diagnostics.
Source SHA-256 changes from
`3e128ac96388c1a6389dc62e2ed6c0c931fe750ab71ea2028c474793316b47dd`
to `65a63ccce8a60e33024a6accbce10757475954a2797c26a3f65522588efaf39f`.

The positive probe uses real production overloads and the candidate annotation
extracted from its AST: ordinary requests retain `Promise<Match[][]>`, expr
requests retain `Promise<ExprMatchResult>`, and the local helper accepts ordinary
descriptors. Two separate **unsuppressed** negative probes each produce TS2345:
passing expr to the extracted helper, and passing expr to regex `inputBytes`.
Removing only the candidate annotation in the task-owned archive reproduces all
three original diagnostics and still emits identical JavaScript. Full source
and diagnostics are retained under `candidate-v1/controls/` and its JSON logs.

## Scope, provenance and preserved failures

- Selected archive: 15 files total, including package/configuration, the exact
  fixture, its eight imported local TypeScript files, and four additional
  worker/protocol-support files. Only the fixture differs across revisions.
- Strict TypeScript 5.9.3 compiler API with committed compiler options, Node
  v22.22.2 on darwin arm64. `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes` and the existing `skipLibCheck` remain unchanged.
  Exact fixture checking uses one root; no include/exclude discovery or new
  exclusions. Logs label compiler diagnostic-derived exit equivalents honestly;
  these are not claimed as invocations of the repository typecheck CLI.
- All local product/test inputs come from exact Git blobs, not live working-tree
  overlays. Full local/imported type-dependency hashes and compiler/tooling
  hashes are captured. Dependencies from installed Node/TypeScript declarations
  are hashed, not claimed to be committed product inputs.
- Selected archive file names and hashes are compared before and after runtime,
  so that check detects added entries as well as modified original files. After
  deliberate type controls, original inputs are restored/rechecked and the
  complete tree is logged, including the recorded extra probes. Git-selected
  inputs are rehashed after execution. This is not an append-proof whole-repo gate.
- `baseline-v1/` and `baseline-v2/` preserve failed runtime setup attempts: the
  temporary archive under `node_modules` caused TypeScript not to emit imported
  modules unless explicitly named as roots. The correction only lists the
  already selected non-fixture runtime closure. `baseline-v3/` is the successful
  baseline. See `setup-failure-v1/README.md` and preserved original driver.
  Neither failed setup is counted as a product failure or a successful test.
- Initial shell PATH/optional-file inspection errors are recorded in
  `CONTROLS.md`. No failed capture was overwritten. All bounded synchronous
  runtime children exited normally; task-owned temporary archives were removed.
- Original FOREIGN-TYPECHECK retains ten unrelated DU TS2307 missing-module
  diagnostics. They were neither fixed nor independently revalidated here.
  No whole-repository typecheck, full gate, native recapture, transport suite,
  broad semantic/performance cohort or superiority claim is made.

`review.mjs` is an explicit opt-in evidence driver, not a canonical test. It
requires a new version argument and refuses an existing output directory. For
another candidate review, invoke it from the repository root with
`node tests/commands/expr-stress/glob-typing-review-20260827/independent/review.mjs review candidate-v2 ec59c917ba137126a064960995b5fc6945ea8f6d`.
The receipt intentionally binds comparisons to the preserved `baseline-v3/`.
Captured TypeScript/JavaScript files have `.txt` suffixes; no canonical source
discovery or committed historical evidence is rewritten by this driver.
