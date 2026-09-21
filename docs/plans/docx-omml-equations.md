# Bounded OMML verification and documentation reconciliation

Scope: only the requested equation task; later tasks remain pending. Work stays
on main, with owned local commits only and no push or release. Preserve historical
evidence and unrelated changes, including the already modified umbrella plan.

## Findings and procedure

1. Read root/scoped instructions, the docx and shared office contracts, the public
   API audit and the pinned API inventory. Inspect the existing implementation
   before changing code. Current source already implements the bounded task;
   no new code defect has been validated, so no product change or artificial
   failing test is justified.
2. Run the maintained docx package tests and lint/type checks, and the selected
   docx workspace build closure. Retain original fraction/matrix/subscript,
   namespace/resource rejection, host-preflight and ordinary-text preservation
   regressions. Resolve any failed verification before claiming a passing gate.
3. Attempt disposable QA acquisition from the manifest source, checking exact
   size and SHA-256 before product admission. Never admit an HTML response as
   document bytes, normalize source data, commit downloads or invoke a reference
   runtime. Purge this invocation's temporary output after recording the result.
4. Correct the stale current-status wording while retaining dated investigation
   findings. Commit explicit owned documentation paths after verification.

## Exact JavaScript/security mappings and drift

| Surface | Mapping |
| --- | --- |
| Physical inventory | Async `inspectDocumentEquations(bytes, options, context)` returns ordered owned snapshots, not live equation model objects. Display wrappers group their direct expressions; inspection expression counts remain distinct. |
| Fragment edits | Async add/replace utilities share `equations.add/replace` typed CLI/SDK/batch admission. `Uint8Array`/explicit BinaryInput replaces unconstrained file input; CLI fragment paths require supplied bounded VFS streaming authority. |
| Selection | Whole source-bound paragraph tokens append one root; whole physical equation tokens replace one same-mode unit. Raw paths are zero-based XML child paths, not one-based equation ordinals. No implicit caret, scope, all-selection or inner-display mutation. |
| Properties | Expanded-name snapshots retain raw strings, duplicate/missing values and nearest scope without defaults, coercion, inheritance or evaluation. Unsupported context is opaque; stored status alone grants no edit authority. |
| Errors and limits | Malformed XML retains XML admission errors; unsupported well-formed fragments/hosts use `unsupported-edit`; stale tokens use `stale-selection`. Shared usage, cancellation, limit and publication categories remain intact. No host resources, fonts, network or expression evaluation. |
| Font.math | The audited `docx.text.run.Font.math` maps to canonical `docx.text.font.Font.math`: neutral public `Font.math` is synchronous boolean/null WML formatting, not an OMML expression API. Existing original formatting-model tests retain that distinction. No new alias or inventory promotion. |
| API coverage | Historical public/inherited members, public underscore-prefixed returns, enums, helpers and collections remain accounted for by the existing audit and scoped overlays. Utility verification does not establish whole public API conformance. |

Documentation drift: the equation evidence page incorrectly presented its dated
pre-implementation investigation as current status, and linked a missing task
plan. This record and the corrected status distinguish existing implementation
from historical preparation and corpus refusal evidence.

## QA acquisition, 2026-09-21

Manifest input: `nz-ghg-inventory-2025-vol-1`, 20,543,015 bytes, SHA-256
`b2470c666193fe39e2f308ed7cd63a9be15da5fd2e7cceb0d8451baf6106148e`.
The publisher URL returned HTTP success with only 212 bytes of HTML challenge,
SHA-256 `d02032286070b4dd9d8fbd985a7bdca8af8edf52b89ff177db3bfcb2c8a9c43d`.
Size/hash admission failed; no new corpus inventory or mutation was executed.
Historical completion QA remains the evidence for 45 units/expressions (one inline,
44 display), 5,045 unit property nodes and 12 global properties, all preserve-only.
Its unsuccessful edits remain unsuccessful; no fresh corpus qualification is claimed.

## Maintained checks

Executed against the current workspace on 2026-09-21:

- `npm run test --workspace=docx -- --maxWorkers=1`: 247 files, 5,152 tests
  passed. The first default-worker run had 5,147 passes and five timeout failures;
  the complete serial rerun passed without changing tests, code or timeout limits.
  An overlapping rerun was stopped; it is not counted as a passing gate.
- Focused equation/property/fragment/command/contract/XML/text suites: eight files,
  152 tests passed, independently of downloaded inputs.
- `npm run lint --workspace=docx`: ESLint and source/test TypeScript checks
  passed, with one unused-variable warning in `operation-types.test.ts`.
- `npm run build:workspaces -- --workspace=docx`: selected maintained build
  closure passed, including its five declared build stages and required portable
  filesystem dependency route.
- Owned documentation diff whitespace validation passed.

Documentation-only reconciliation does not change CLI visuals or require new
screenshot captures; original visual qualification remains in the historical
completion receipt. Temporary downloads and this invocation's test log are purged.
The bounded implementation is verified by original tests; fresh downloaded-input
qualification remains unavailable. Later tasks and unrelated work are untouched.
