# Labeled blocks

## Validated gap

SafeJS rejected JavaScript labeled blocks. Native execution comparisons cover
single and adjacent labels, breaking out of nested loops, and continuing an outer
loop. Native syntax checks also reject duplicate active labels, missing targets,
cross-function targets, and continue targeting a non-iteration label.

## Implementation

Track active labels per function during parsing, attach block labels to the AST,
and consume matching break completions at the labeled block. Preserve existing
loop label behavior. Allow these blocks in the harness linter, including adjacent
labels and intervening comments. Other labeled statement forms remain a gap.

## Verification

The actual CLI screenshot exposed the linter mismatch after interpreter tests
passed. Four new lint cases failed before the fix. The combined lint-rule,
parser, interpreter, and labeled-block tests now pass all 608 cases. Changed
TypeScript files pass ESLint. The actual CLI harness passes, and its screenshot
was inspected. It also exposes a separate false unreachable warning after the
labeled block; that diagnostic needs a follow-up correction.
