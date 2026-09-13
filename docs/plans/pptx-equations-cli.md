# Equation command integration

Ownership: equation command/schema files, command-engine equation routing only,
the exact safe-bash equation test and its integration inventory assertion.

Implement `equations list`, `equations get`, and `equations add` through the
byte SDK. Require one explicit caller-authored OMML file and a selected text
body for insertion. Keep scopes slide-local, singular reads unambiguous,
and output/JSON/publication semantics shared with other office commands.
Advertise set/remove, rendering and evaluation as unavailable.
Simple shape labels require one explicit slide. Tokens address the containing
shape; zero-based paragraph/equation ordinals are informational, and singular
reads fail when the selected shape contains multiple equations.

TDD evidence: the initial command tests failed with unsupported-operation before
equation routing was added. Original memfs cases cover Unicode extraction,
wrong/absent namespaces, malformed input, entity prohibition, unsupported
extensions, dry run and no-publication behavior. The shell test runs a quoted
virtual script, compares output bytes with SDK output, and independently parses
OMML text and the compatibility fallback with a namespace-aware XML parser.

The upstream test/API audit and inventory contain no direct OMML command cases;
math preset shape enum entries are separate geometry APIs, not equation APIs.
The root research owner records exact broader preservation obligations and
language/security mappings. No upstream implementation or fixture is copied.

Validation procedure:

1. Run focused command/domain tests and package maintained tests/lint.
2. Build the selected pptx workspace closure before testing the shell's public
   package import; execute only the exact equation adapter tests and maintained
   integration inventory checks, not the entire pipeline.
3. Inspect generated equation help/JSON output through the repository screenshot
   route; root integration owner records visual QA.
4. Root stages only owned changes and commits after scoped checks pass; no push.

Recorded verification: 10 command-engine tests and 2 public-package shell tests
passed; `npm run lint --workspace=pptx` and the maintained selected workspace
build closure passed. The original red failures were unsupported-operation for
list/add routing. The shell round trip independently confirmed the inserted
Unicode math text and one explicit compatibility fallback.

Final rebuilt adapter rerun: `node --import tsx --test
packages/safe-bash/tests/commands/pptx/equations.test.ts` passed 2/2.
`node --test --test-name-pattern='default normal runner passes every discovered
active file to serial Node execution'
packages/safe-bash/scripts/integration-inputs.test.mjs` passed its one selected
inventory check (1086 discovered active files).

Focused guarded lint followed the existing procedure in
`docs/plans/pptx-advanced-chart-cli.md`: unchanged guarded root configuration,
createLintSelection, fresh one-shot guard, all 25 authenticated receipts, then
exact owned test and integration-registration file classification/read/lintText.
Two subjects, zero messages/errors/warnings, failed false, 2010 balanced opens
and closes. No maintained exact-test typing selector exists in safe-bash;
full safe-bash typecheck/pipeline was not run or claimed. PPTX source/test types
passed the maintained package lint route.
