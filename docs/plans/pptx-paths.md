# Bounded custom paths

Implement F23 in `packages/pptx` under the PPTX and shared office contracts.
The current task explicitly adds bounded quadratic/cubic curves to the earlier
move/line-only proposal. Preserve unrelated custom geometry and guide formulas
exactly; never evaluate formulas or infer a geometry engine. No whole pipeline,
README edits, fixture publication, push or release.

## Ownership

- Geometry worker: new path domain implementation/tests, package exports and
  minimal shape-selection helper exports.
- Command worker: path command parsing/schema/help/capabilities and original
  memfs SDK/CLI tests; scoped safe-bash adapter tests if required.
- Accounting worker: exact relevant source-case and public-API research ledgers,
  with original independent cases and explicit remaining model obligations.
- Root: specification reconciliation, draft usage, QA, integration review,
  maintained checks and explicit-file local commits on main.

## Contract and verification

Use explicit local EMU coordinates, an explicit positive path viewport, bounded
integer values and command counts. Support ordered move, line, quadratic, cubic
and close commands. Preserve contour ordering, winding and explicit closure;
do not calculate intersections, simplify, flatten curves or evaluate guides.
Shapes retain independently declared placement/extents. Reject malformed command
state, unknown keys/types, accessors, nonfinite/fractional/out-of-range values,
unavailable geometric operations and replacement of unsupported existing paths.

Write failing original regressions first. Assert literal XML command/point order,
coordinate values and unchanged package members independently of the reader.
Exercise SDK and command parity, namespace dialects, selectors, failures before
publication, explicit output, dry-run, help/schema/capabilities and common statuses.
Keep every relevant parametrized/BDD identity in research, including gaps; do
not equate bounded operation support with the entire freeform model API.

The vendor descriptions of [quadratic commands](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.quadraticbeziercurveto?view=openxml-3.0.1)
and [cubic commands](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.cubicbeziercurveto?view=openxml-3.0.1)
identify respectively one/two control points followed by the endpoint, in path
coordinates. These are format research sources, not a rendering implementation.

## Disposable QA procedure

1. Admit existing cache files only from `docs/pptx/corpus-manifest.json`; verify
   byte lengths and SHA-256 before reading their package contents.
2. Select a small cached presentation. Read existing custom paths and add one
   original path containing line and curve commands using explicit placement.
   Compare independent XML expectations and all unrelated decoded members.
3. Use actual safe-bash Shell with explicit memory filesystem and command
   engine, compare SDK and CLI outputs, and retain inputs unmodified. Keep QA
   outputs in memory or a disposable ignored path; never ship corpus bytes.
4. Test unsupported existing geometry refusal, preserving exact formulas on an
   unrelated metadata update. Reduce meaningful findings to original regressions.
5. Capture and inspect help/error output with the maintained screenshot route.
   Screenshots validate terminal readability, not slide rendering fidelity.
6. Run the maintained selected package build closure, package lint/tests and
   relevant compiled adapter consumers. Record actual receipts and limitations.

## Receipts

Initial Git inspection found main and unrelated existing research/spec/plan
changes; those remain outside this task.

- TDD: missing path module and CLI paths failed before implementation. Review
  regressions caught ignored set update fields, nested accessors executing during
  validation, missing object-vertex support and incorrect closure/help grammar.
  Those failures were corrected without changing unrelated package behavior.
- Maintained selected build closure passed: `npm run build:workspaces --
  --workspace=pptx` built the three declared dependencies/workspaces. Package
  `npm run lint --workspace=pptx` passed ESLint and production/test type checks.
- `npm run test --workspace=pptx` passed 79 files and 2,270 cases in 27.88s.
  The new core/security/independent/CLI path files contributed 45 cases at that
  checkpoint. Final additional coverage and help checks are recorded below.
- Three existing compiled-package adapter consumer files passed 89 cases via
  `node --import tsx --test --test-concurrency=1 --test-reporter=dot` with the
  explicit `create.test.ts`, `selectors.test.ts`, `inventory.test.ts` paths under
  `packages/safe-bash/tests/commands/pptx`. No adapter source change was needed.
- Corpus QA admitted the manifest's cached provider-training deck, 6,824,998
  bytes, SHA-256 `3695972c410e1a8862f72962d706bdfde1e680a144b48bf2bb9bb8095ecca3b5`.
  The archive census contains 31 custom geometries; the SDK's slide-local shape
  query returned 27, all preserve-only. Replacing an unsupported path failed;
  an unrelated title edit retained its complete geometry XML byte-for-byte.
- Adding the original ribbon through compiled SDK and actual safe-bash Shell
  with explicit memory filesystem produced identical 6,825,193-byte outputs,
  SHA-256 `34cdb5e6741805186a5a8085d339f130fa51dddcf95a7ffc8dcfa43128a5ae71`.
  All 119 decoded member identities and payloads were compared: only
  `/ppt/slides/slide1.xml` changed. Literal quadratic/cubic control order and
  closure were asserted independently. Input bytes and host cache hash stayed
  unchanged. QA outputs remained in memory.
- QA setup corrections: package-reader inspection is an internal test utility,
  not a package index export; archive member order is normalized during writing,
  so member identity comparison uses sorted names; the full archive custom-path
  count is not the slide-local shape-query count. These were QA assertion errors,
  not product defects, and were corrected without product workarounds.
- The first actual Shell help/error screenshot was rendered by `npm run
  screenshot -- --output /tmp/pptx-paths-help.png --no-header node --import tsx
  --input-type=module -e ...` using the inline Shell/engine setup. Visual review
  found misleading required-path/slide wording; the CLI owner reproduced and
  corrected it. `/tmp/pptx-paths-help-final.png` was recaptured through the same
  route and visually inspected: complete readable output, no clipping, correct
  read/add selection wording and help/error statuses 0/2. No slide-rendering
  engine was used or implied.
- [Case accounting](../pptx/path-case-map.json) retains all 64 relevant source
  rows; [API accounting](../pptx/path-api-map.json) retains 26 inventory records
  plus six newly discovered public-member obligations. Full builder defaults,
  offsets/scaling, protocols and ownership are still gaps. No deferred or partial
  row counts as complete API parity.
- Final review added 12 original cases for Strict namespace output, all inclusive
  coordinate/command limits, unknown geometry metadata, invalid XML command
  arity, formula-valued points, preset refusal and picture/connector geometry.
  Picture/connector reads initially threw; the reduced originals reproduced it.
  Their raw geometry is now inspectable and remains preserve-only. Rechecking
  the admitted corpus after this change still found 27 slide-local custom paths;
  the remaining full-archive census entries are not inferred to be editable.
- Final maintained selected build closure passed after the reader/help changes.
  Final package tests passed all 79 files / 2,282 cases in 23.02s; package lint
  passed after the final production and test edits. Source-pointer validation
  confirmed all 64 case rows resolve to their inventory entries with unique IDs.
  Git whitespace checks passed. Only named owned files are included in the local
  feature commit; unrelated files, cached fixtures and screenshots remain out.
