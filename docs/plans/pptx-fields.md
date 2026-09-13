# Explicit field caches

Scope: F21 inline DrawingML fields, integrated with the existing byte SDK and
registered safe-bash command engine. This task does not run the whole pipeline.

- Add original failing tests before implementing field cache policy.
- Default preserve retains the existing cache; add starts with an empty cache.
  Text/time without explicit update is rejected. Explicit date edits require a
  valid caller timestamp and supplied text; the engine never evaluates it.
- Support slide-number, date, footer and header field types; preserve unknown
  types until the caller explicitly chooses a supported kind. Existing date
  format type tokens remain unchanged when no kind is supplied.
- Add targets one text body and appends to its final paragraph before end-run
  metadata. IDs are deterministic and collision checked in the owning part.
- List/get read local cached values. Shared fields require explicit scope; no
  inherited text or styling is copied into the slide.
- Verify SDK/CLI parity, schema constraints, strict UTC admission, empty and
  ambiguous selection, exact mixed-script caches, unrelated formatting, and
  registered shell-script execution using memfs only.
- Review corpus-manifest fixtures through disposable root-coordinated QA and
  inspect the help screenshot. Reduce defects to original regressions.

Evidence: fields.test.ts and command-fields.test.ts initially failed without the
API/routes. New cache policy is supplemental original coverage; the upstream
unit/BDD field-related extraction, clearing and fitting cases remain tracked in
upstream-test-inventory.json and test-case-map.json. No reference implementation
or assets were copied. Existing standalone legal notices remain unchanged.

Checks: focused field tests; maintained pptx lint/build/unit route; direct
`node --import tsx --test packages/safe-bash/tests/commands/pptx/fields.test.ts`
route for the registered fields command. Root owns
corpus QA and visual review evidence and records final checks/commit separately.

Root QA found the initial field help line too wide; an original regression now
requires help lines at most 80 columns and checks the publication controls.
Shared JSON review exposed a draft result mismatch; failing assertions preceded
replacement with ResourceData and MutationData on the new field routes. Existing
unknown field edits now have a document-feature error (unsupported-edit,
validate-intent, exit 1), independently exercised through SDK and CLI.

Focused final evidence: 32 field tests pass. Before the result-contract revision,
the full maintained pptx unit route passed 72 files / 1887 tests and lint passed;
root reruns maintained checks on the final shared tree. The direct registered
shell test passed before the result revision and is rerun after rebuilding.
An attempted direct virtual-bash workspace run ignored SAFE_BASH_TEST_RG and was
stopped rather than completing its unrequested broad discovery; its runner
checks passed 499 cases, but the stopped broad run is not a successful scope check.

Independent review reproduced a field-coordinate bug: paragraph properties were
counted as text inlines. Three original cases cover pPr/endParaRPr, a foreign
same-local-name element, and a soft break. Reads now index only same-namespace
runs, breaks and fields; set/remove also reject foreign namespace matches while
preserving that markup. SDK/CLI positions, retained local field formatting and
exact opaque markup are asserted independently. Final focused field count: 35.

Final root checks: 1,897 tests across 72 pptx files passed, package lint passed,
selected maintained pptx build passed, and the four explicit safe-bash pptx
test files passed against rebuilt output. Focused adapter-test ESLint passed.
Root inspected the corrected help screenshot and recorded exact SDK/CLI corpus
byte equality and untouched-member preservation in
`pptx-international-fields-qa.md`. No push or release.
