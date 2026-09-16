# PPTX transforms

Scope: position, size, rotation and flips; nested coordinate inspection. Grouping,
ungrouping and alignment are separate work. Root owns package code, tests and
these documents. No safe-bash adapter changes are needed: its existing adapter
delegates to the package command engine. No scoped AGENTS.md exists in packages/pptx.

Implement with failing original tests first. Verify independent corner coordinates,
negative offsets, half-away rounding, invalid sizes/angles/booleans, partial updates,
namespace preservation and SDK/CLI parity through memfs. Keep source-case and public
API accounting in docs/pptx; explicitly retain neighboring unimplemented APIs.

QA procedure: run focused tests, package test/lint and selected workspace build;
inspect a screenshot of command help and a command result. Use only manifest-listed
cached corpus bytes for optional read/edit/reopen checks, with hashes verified
before admission. Keep temporary outputs out of Git. Do not run the whole pipeline,
push, release or edit README files.

Initial inspection: position/size and rotation already exist for p:sp, but flips
are absent; rotation rounds after modulo normalization; group-space coordinates
are returned without a coordinate label or slide-space corner projection.

## Implementation and evidence

- Original tests reproduced signed half-angle loss, full-turn serialization and
  floating modulo noise in angle getters. Integer angle rounding/normalization
  fixes those behaviors. Original rejection cases also reproduced SDK acceptance
  beyond the CLI's geometry bound; both now reject the same rounded out-of-range
  coordinates.
- Added strict boolean flips and transform-only edits for pictures, connectors,
  graphic frames and groups. A new original regression caught missing frame
  transforms inserted after DrawingML payloads; insertion now observes the mixed
  namespace sequence while preserving the payload.
- Added explicit parent-space metadata and slide-space corner projection.
  Independent nested calculation: inner mapping `(x,y) -> (180-y,130-2*x)`, then
  outer mapping `(x,y) -> (1300-x,2600-2*y)`. For local box (-10,20,40,20), the
  projected corners are (1140,2300), (1140,2460), (1160,2460), (1160,2300).
  Changing local left to -20 yields y values 2260 and 2420 without changing
  parent transforms. Both byte SDK and memfs CLI exercise this case.
- Independent tests cover center rotation, flip order, strict namespaces, child
  origins, fractional intermediate scales, negative half-EMU offsets, missing
  ownership, singular child extents, nonfinite values and invalid dimensions.
- `docs/pptx/transform-case-map.json` retains 93 exact research rows: 42 base
  geometry variants with domain assertions, 30 expanded examples with domain
  workflow assertions and explicit live-model gaps, and 21 adjacent inherited
  geometry/group-recalculation obligations. The two position/size setter source
  cases per kind share one original test that independently asserts both XML
  pairs; this merger is semantic, not a row deletion. Numeric tuple values are
  retained; XML strings, labels, test wording and assets are original.
- `docs/pptx/transform-api-map.json` retains all 80 selected documented geometry
  members, including inherited and underscore-prefixed owners. Five standalone
  Shape members have model evidence; 75 document-owned subclass members remain
  planned. Boolean flips and bounded coordinate projection are typed extensions.
  Existing research audit statements describe the historical baseline, not this
  implementation. Full model API parity is not claimed.
- The spec remains Proposed / Implemented Through: Not applicable; inspected HEAD
  before this work was `23ed14d56663feb76d3f64ca539c61b72a38766c`. The new normative
  transform section and exact flags clarify desired behavior without claiming the
  entire specification is implemented. Spec checker: zero warnings/errors.
- Existing package THIRD_PARTY_NOTICES.txt retains the required MIT notice;
  source identities occur only in research and existing standalone legal notices.

## Disposable QA

Admitted the manifest's first fixture only after verifying its 1,202,514-byte size
and SHA-256 `885e923f148cdf4680372abe54496c824ab3a2a2d8a59fd9703d66e0aeb1164c`.
An original rectangle was added in memory, then rotated 90 degrees and flipped
horizontally through actual Shell and byte SDK operations. Publications matched
exactly: 1,202,665 bytes, SHA-256
`ea21e53abf5fbd6766696997223a89dcfa51fcad676ac51228dc59f522372281`.
Only `/ppt/slides/slide1.xml` changed relative to the seeded deck; original cached
bytes and VFS input remained unchanged. Literal projected corners were
(20,50), (20,10), (0,10), (0,50). Output remained in memory. No corpus defect was
found, so no corpus-derived regression or fixture was added.

Captured actual adapter help and invalid-flip output using the maintained generic
`npm run screenshot` route, since `pptx` is an explicit Shell command rather than
a root poe-code command. `/tmp/pptx-transforms-help.png` was visually inspected:
complete readable help, explicit coordinate meanings, no clipped lines, statuses
0 and 2. This is terminal QA, not slide-rendering evidence. The screenshot is not
staged. No downloads, native document runtime, README edits, pipeline execution,
push or release occurred.

## Validation

- First maintained package run: 81 files / 2,370 tests passed before final added
  bounds, mixed-namespace insertion and nested command regressions.
- Focused original geometry/behavior/command suites passed after those additions.
- Final package lint (ESLint, source and test typechecking) passed.
- Final selected `pptx` workspace build closure passed: three declared builds.
- Existing actual safe-bash adapter suites create/selectors/inventory: 89 cases
  passed using the maintained node:test runner and explicit file operands.
- Final maintained package run passed: 81 files / 2,385 tests, including 101
  original pure geometry cases and 15 command cases (two new memfs workflows).
- Ledger checks verified 93 unique exact inventory identities and 80 unique API
  inventory bindings. Spec checker passed with zero warnings; `git diff --check`
  passed. No source identities appeared in new product/test files.
- Delivery is one focused local transform commit on main; the commit hash is
  reported separately in the completion response. No remote delivery or release
  is authorized by this task.
