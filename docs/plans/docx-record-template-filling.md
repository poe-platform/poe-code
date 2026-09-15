# Bounded record template filling

Scope: task 65 only. Later tasks remain pending. Work stays on main; owned files
are staged explicitly for one atomic feature commit, with no push or release.

Read root/scoped guidance, docx and shared Office CLI/SDK specifications, and
historical API audit/inventory. Existing repeat/binding evidence is preserved.

## Contract and language/security mapping

Add async `applyDocumentTemplate(bytes, options, context)` and the existing
`template apply` path with the same typed `data`/data-json/data-file schema.
A record has `values` containing unique exact binding keys. Scalars retain string,
boolean and finite number identity. A repeat entry has an array of records;
no expressions, coercion, callbacks, host I/O or fetching are admitted.
Content-control tags explicitly declare bindings. Literal placeholders are exactly
`{{tag}}` in a tagged text control, including split runs; ordinary brace text
outside a tagged control remains unchanged. No implicit document concatenation.
Top-level data arrays require exactly one body repeat region and no singleton
bindings. Nested repeat arrays use their own tagged native repeat declaration.
Maximum nesting is four repeat levels, each region at most 1,000 data items,
with cumulative matches/inserted-node/media/table/work/output host ceilings.
Empty repeats retain one cleared reusable native placeholder item.

Reuse staged document sessions and original scalar/repeat editors, with one
external publication after all schema, feature and reference validation. Nested
repeat admission is confined to template execution; controls repeat keeps its
original rejection policy. IDs/relationships remap per repetition. Bound, locked,
opaque, reviewed or crossing-reference templates refuse; unrelated body content
and nonbody stories stay intact. No live model/API coverage is promoted.

This is additive F47 utility behavior with no exact source API/test counterpart.
Document/Part/XmlPart, inherited members, enums, collections, helpers, prose-only
APIs and publicly documented underscore-prefixed owners retain historical
inventory dispositions. Neutral model spellings are unchanged. Historical
inventory is research evidence, not an implementation completeness certificate.

## Verification sequence

1. Add original memfs regressions and capture unsupported/missing-export and
   nested/schema reds before implementation.
2. Implement bounded shared template orchestration and CLI/schema/export wiring.
3. Verify empty/multilingual/typed records, duplicate/missing/schema/cardinality
   errors, nested rows/sections, ID/relationship integrity, preservation, budgets,
   dry-run/failed publication and actual command engine.
4. Run maintained DOCX unit/lint/selected build, portable export checks and
   relevant existing Shell checks. Inspect terminal screenshots as ad hoc QA.
5. Record evidence and commit only owned files. No downloads/reference runtime,
   push/release or later task work.

## Executed implementation and red/green evidence

Inspected baseline: `ec9560442ef4677eae660780f09a4567c62e90ad`. Root guidance,
scoped safe-bash guidance and the shared specs were read. Parsed all 920 historical
API inventory rows; 185 public underscore-prefixed rows remain explicitly visible.
No research owner/disposition was promoted and no reference runtime/download ran.

- Initial original reds: 14 template tests failed on the missing public export and
  unsupported engine route, `/tmp/docx65-original-red.log`.
- Nested expansion required exact-owner selection, admitted native item ancestors
  and native table-row counting. Expanded original cases qualified these changes.
- A conflicting later nested item schema was silently discarded; original red
  `/tmp/docx65-later-nested-schema-red.log`, then recursive schema census green.
- An undeclared enclosing control allowed repeat expansion; original red
  `/tmp/docx65-ancestor-red.log`, then explicit unlocked native ancestry green.
- A later discarded nested date format bypassed admission; original red
  `/tmp/docx65-prior-format-red.log`, then all-prior scalar/graph/media preflight.
- A later discarded native container accepted an unwrapped block; original red
  `/tmp/docx65-prior-container-red.log`, then all-prior native container admission.
- CLI/SDK schema nesting drift and an incorrectly safe-integer-bounded finite
  record-number schema produced original reds at
  `/tmp/docx65-schema-parity-red.log` and `/tmp/docx65-finite-schema-red.log`.
  Both schemas now share the same bounded definitions and finite JSON number type.
- Scalar rendering and native repeat graph remapping reuse the original editors
  through an invocation-local DocumentSession; only the final outer call can
  publish. The template-only internal admission marker does not change the
  original single-level controls-repeat policy or expose an expression evaluator.
- Conservative work/retention reservation precedes the declaration census;
  source/index bounds and shared cumulative ledgers cover staged processing.

Original final template cases: 30, including nested empty/refill rows/sections,
multilingual strings, false/empty identity, exact keys/cardinality/limits,
all-prior schema/format/container admission, lock/binding/crossing refusal,
post-expansion bookmark/classic-comment/drawing/relationship integrity and exact
PNG preservation/media budgets. Final template/public portable export cohort:
32 passes at `/tmp/docx65-final-domain-public.log`.

Actual Shell frozen cohort: 18 passes, zero failures/skips/cancellations, at
`/tmp/docx65-frozen-shell.log`, using the maintained reporting runner and cleared
repository-local child Git environment variables. The independently explicit
literal inputs were `tests/commands/docx/control-records.test.ts` and
`tests/commands/docx-registration.test.ts`. Two intermediate Shell fixture errors
used an unregistered cat command and an incompletely backed redirected input;
no shell product change was made. The final cases use original docx binary
pipelines, an explicit VFS JSON file/script and preserved input/output fixtures.

Maintained safe-bash runner gate: 515 passes, no skips/failures, at
`/tmp/docx65-shell-runner.log`; historical registrations/seals remain intact.
Frozen maintained DOCX lint passed source/test TypeScript and ESLint, with one
existing warning in untouched operation-types.test.ts, at
`/tmp/docx65-frozen-lint.log`. Earlier evolving full-unit runs are intermediate
and do not qualify the final source. The first clean evolving run had 151 files /
3,057 passes; subsequent adversarial source reopening requires frozen rechecking.

Ad hoc terminal QA uses the maintained `npm run screenshot` capture route because
DOCX is an explicit injected plugin, not a default root poe-code command. Root's
screenshot-poe-code route would exercise an unrelated root command and full
predev build. The agent executed this QA from this Markdown procedure; no new QA
script was authored. Inspected 100-column PTY captures:
`/tmp/docx65-template-help-readable.png` and `/tmp/docx65-template-result.png`.
Help/options and human dry-run result are readable, without clipping or overlap.
The first non-PTY capture retained a long harness command header and is preliminary
capture evidence only. No document renderer/repair-warning verification is claimed.

Usage/evidence: `docs/docx/record-template-filling.md`. Sole authoritative spec
remains Proposed / Implemented Through Not applicable; only the bounded task
contract and drift correction changed. Spec checker passes with zero warnings.
Later tasks, template utility batches, live-model owners and full conformance
remain pending. No README additions, QA fixture commits, push or release.

## Final task 65 acceptance

- Frozen maintained uncached `npm test --workspace=docx`: 151 files / 3,060 tests
  passed, zero failures, `/tmp/docx65-frozen-unit.log`.
- Frozen maintained `npm run lint --workspace=docx`: source/test TypeScript and
  ESLint passed; one existing untouched-test warning, `/tmp/docx65-frozen-lint.log`.
- Selected maintained `npm run build:workspaces -- --workspace=docx`: passed after
  unit execution, including maintained dependency closure/native suffix stages,
  `/tmp/docx65-frozen-build.log`. No native reference implementation was built.
- Original template and portable public export cohort: 32 passes.
- Frozen actual Shell and optional registration: 18 passes, no skips/failures.
- Maintained safe-bash runner/input gate: 515 passes, no skips/failures.
- Built root `poe-code/docx` self-reference export and public dry-run consumer:
  passed at `/tmp/docx65-built-consumer.log`; no packed-distribution qualification
  is claimed by this self-reference smoke.
- Sole authoritative spec checker: zero errors/warnings. Ad hoc terminal help
  and result screenshots inspected; no Word rendering claim.

This bounded feature is accepted for its owned local Conventional Commit on
main. Stage only task-owned paths, including this plan, spec/audit/usage records,
DOCX implementation/tests, the existing control-record Shell test file and the
single public export assertion. Preserve unrelated OMML evidence, pipeline status
changes, the Pyodide plan and QA output directories. Later tasks remain pending.
Delivery here is local commit only: no remote-main verification, push or release.
