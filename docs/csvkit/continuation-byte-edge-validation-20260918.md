# csvkit user byte-boundary review, 2026-09-18

Procedure: `docs/plans/csvkit-continuation-byte-edge-qa.md`. Independent Shell
review: `continuation-independent-validation.md` and its linked procedure.

The original new domain cohort tests actual csvformat, in2csv JSON/NDJSON,
csvjson streaming and csvstat count algorithms through both executable argv and
SDK settings. Ten canonical tests enumerate every two-chunk byte split and a
reused single-byte producer for stdin and named memfs input: 796 engine executions.
Exact assertions
cover stdout/stderr/status, unchanged file bytes and namespace, and exactly one
source finalization. Input includes split UTF-8 BOM, astral/Asian text, quoted
physical LF, prototype-like JSON names, exact integers beyond binary64 and
disjoint NDJSON columns. There are no native programs, network requests, real
databases, disk fixture creation or mocked successful engines in this cohort.

No product defect was reproduced. Initial new-test failures were incorrect SDK
destinations (`stream`/`count` instead of the declared `streamOutput`/`count_only`),
then lint rejected a throw-only generator and TypeScript rejected an overly broad
request union when adding a named input. These test-authoring errors were fixed
without changing the engine or weakening output/effect expectations.

Verification completed:

- Baseline maintained csvkit workspace tests: 93 files, 4,345 passed, one skipped,
  five TODOs. Expanded maintained run: 94 files, 4,355 passed, one skipped, five
  TODOs. These six unresolved cases are not passes.
- Final focused domain cohort: ten tests passed with tsx caching disabled.
- Maintained selected csvkit build closure: four workspace builds passed,
  derived by the workspace runner from current declarations.
- Maintained csvkit lint, product TypeScript and test TypeScript checks passed.
- Focused ESLint for the new Shell cohort and discovery assertion file passed.
- Maintained safe-bash typecheck passed source/tests, the authenticated historical
  consumer, four current source-consumer groups and 26 built public-consumer
  groups; three negative consumers failed compilation as required. This was
  compile-only qualification, with zero runtime executions and scratch cleaned.
- Independent agent: thirteen supported Shell composition/effect cases and twelve
  explicit quoting refusal assertions passed uncached. The latter verify honest
  blockers, not csvkit compatibility. Maintained safe-bash runner: 536 assertions
  passed with no skips/TODOs. Its literal-path discovery assertion registers the
  new maintained test. Representative actual built pipeline screenshots were
  inspected and reduced by that agent; its owned temporary evidence was purged.

The skipped reader case concerns non-string quoting modes; the five encoding
TODOs concern environment/output stream encoding profiles. Existing broader
codec/locale/workbook/DBF, SQL service/driver, Python/Agate/IPython and interactive
qualification limits remain in the prior implementation reports. This bounded
campaign does not establish all-option/all-input compatibility or a full
repository/safe-bash unit acceptance. Product source, README content, staging,
commits, pushes and publication were untouched by this pass.
