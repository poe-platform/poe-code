# Animation batch syntax preflight

Scope: close a validated upfront-validation defect in the existing bounded
animation SDK and batch command. This is not implementation of the whole
proposed batch union or public object model.

## Evidence and procedure

- Read root and safe-bash ownership rules, `docs/specs/pptx.md`,
  `docs/specs/office-cli.md`, and `docs/specs/office-sdk.md`.
- Reproduce malformed target/selector values using an explicit byte source;
  require `invalid-value` and zero source reads for direct SDK calls and for a
  malformed second batch operation after a syntactically valid first operation.
- Thirteen original parameter cases initially failed with `invalid-archive`:
  syntax validation had already invoked the input source.
- Validate nested coordinates, selector combinations, selector values, canonical
  tokens and location fields before acquisition. Keep well-formed stale tokens
  and missing targets as semantic errors against the admitted snapshot.
- Run package lint/types and maintained package unit checks, plus delegated
  safe-bash CLI tests for preflight, staged failure, stale identities and
  deterministic dry-run/output. Do not run the whole pipeline.

## Provenance and mappings

Consulted `docs/pptx/upstream-test-audit.md`, `upstream-test-inventory.json`,
`upstream-api-audit.md`, `upstream-api-inventory.json`, and
`corpus-manifest.json`. This work adds original sandbox/transaction regression
coverage, not adaptation of a new upstream feature family. Existing F46
accounting remains authoritative; no upstream parameter or BDD row is claimed
as newly covered. No source wording/assets were copied and no legal notice was
removed. No disposable corpus fixture is needed to reproduce this pure syntax
bug, and no unit test downloads or writes host files.

JS mapping: operation records remain plain data; accessor-backed fields are
rejected before evaluation. SDK positions explicitly name zero/one-based
coordinates; CLI positions remain one-based. Canonical token strings and typed
location objects carry SHA-256 input identity. Syntax errors are usage failures;
well-formed foreign fingerprints remain stale-selection failures. No model
method/property spelling changes or inherited/underscore API reclassification.

## Remaining scope

The animation-only batch is not the complete registered union. Created-object
handles, shared-resource/signature dry-run effects, full cumulative transaction
budgets and whole-public-API coverage remain outstanding. Existing discovery
explicitly advertises the bounded animation subset. Do not infer full conformance
from this fix or these checks.

## Verification receipt

- Final focused SDK/engine run: 43 tests passed, including 14 new preflight
  cases. An additional original regression caught executable `toJSON`/BigInt
  values in typed locations; primitive string validation now precedes encoding.
- `npm run lint --workspace=pptx`: passed (ESLint, production and test types).
- `npm run build:workspaces -- --workspace=pptx`: passed the declared three-build
  dependency closure. Public-import adapter tests use these compiled exports.
- Broader `npm run test:unit --workspace=pptx`: 4,410 passed / four failed during
  development. One was the new serialization-hook regression, now green in the
  final focused run. Three remain in unrelated untracked sanitization tests:
  a fixture ZIP minimum-version assertion and two command report expectations.
  Preserve that work; this receipt does not claim a passing whole package suite.
- Safe-bash normal-runner discovery assertion reached the new batch test but
  failed on an unrelated registered, missing sanitization test path. The batch
  test's exact literal registration was added without staging other edits.
- Manual terminal QA used `npm run screenshot -- --output
  /tmp/pptx-animation-preflight.png --no-header node --import tsx
  --input-type=module -e ...` with an explicitly injected memory Shell and the
  public `pptx` engine. Sent a malformed target against a missing input;
  inspected the PNG: clear `invalid-value` diagnostic and exit 2. The first QA
  invocation passed a plugin as a registry and was corrected to `Shell.use`;
  this was QA setup, not a product defect. No screenshot or fixture is staged.
- Final public-import safe-bash run: six tests passed (new five-case batch suite
  plus the existing animation script suite). Maintained discovery independently
  confirms the new test is included.
