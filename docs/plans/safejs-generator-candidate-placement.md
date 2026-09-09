# Generator snapshot placement repair

## Validated defect

Isolated shared-memory candidate build 78157 exposed a syntax error already
present in committed `guest-heap.ts`: a `request.resultPrototype` object spread
was placed as a standalone statement in the async-function driver branch,
rather than inside the async-generator request record. That line came from
52d8ad42b. The live working tree already contains its relocation, which is why
working-tree validation did not expose the committed defect.

Related result-prototype placements from the same change were also outside
their intended lifecycle boundaries: generator measurement was nested inside
the property loop, generator serialization inside the optional block-scope
object, and restoration after the driver had already consumed its origin.

## Scope

Select only the existing relocation hunks in `values.ts`, `guest-heap.ts`, and
`restore.ts`. Preserve all working-tree contents; exclude the unrelated weak-
collection implementation and the cosmetic type-field relocation. This repair
is a separate prerequisite commit, not part of the shared-memory feature.

The private repair index is `/tmp/safejs-shared-commit.eCW6K7/repair-index`.
The combined candidate includes the same relocations plus shared-memory work.
Generator result-realm, delegated-result, snapshot restore, and shared-memory
checks run against that exported candidate; their results must be recorded
before claiming verification. No push or release is authorized during the hold.

The corrected combined candidate passes package TypeScript (45924) and 225 tests
with one skip in nine files (93303). This includes the three generator/snapshot
files above and shared-memory/legacy-checkpoint tests after unrelated weak-
collection changes were removed from the candidate. Candidate lint is underway.

Candidate lint completed successfully (48431). The corrected selected build
also passed (8066): 23 builds and four fresh-process SafeJS import checks.
