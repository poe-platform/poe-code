# Additive fixture/harness corrections, after original execution

The frozen files and all original failure receipts remain unchanged. Six of 125
first-run rows failed; these corrections do not erase that denominator.

- L02-heading-paragraph: the final ordinary sentence period is not syntactically
  active Markdown. The frozen literal over-specified its escaping; accept either
  literal period or escaped period in this position. This does NOT excuse ordered
  list punctuation injection at a line start; that has a separate source repro.
- L06-raw-ordinary-text: escaped square brackets already prevent a link. Literal
  parentheses around z are semantically equivalent here. Accept the frozen output
  or the same literal text with parentheses not backslash-escaped. Raw angle
  brackets, asterisks and brackets must remain escaped.
- U-title-alt-injection: the first runner incorrectly searched for `<img` even
  inside `\<img`. Version 2 checks exact escaped label structure and independently
  parses the output with authenticated Pandoc CommonMark as a bounded reference.
  It must have only the intended safe link/image, no RawInline/RawBlock, and no
  injected javascript destination. No universal downstream sanitization claim.
- B10-files, B11-args: README lines 26–27 specify invalid CLI usage status 2.
  Too many operands/oversized arguments are usage constraints. The original
  frozen status 1 was mistaken; v2 asserts 2 AND the exact failure kind, not merely
  any nonzero exit.
- P11-shell-middleware: original JS middleware awaited next but returned undefined.
  The inspected public `src/contracts/plugin.ts` lines 4–9 require a CommandResult.
  Version 2 returns `await next()`; real Shell dispatch, middleware observation,
  VFS redirection and disposal remain mandatory. This is not a product bug.

No expected output/status of a discovered source defect is relaxed. These are
additive tests with v2 IDs, not a rewritten freeze or author-influenced holdout.
