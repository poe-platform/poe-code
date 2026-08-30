# Old canonical expectation audit

All line numbers below bind commit
`1b2ddea9e38b25cc91134a2f35a318e27f4d7c29`, not the concurrently changing
worktree. `canonical-audit-01/inventory-and-excerpts.json` records hashes of all
12 canonical expr test files, three input fixtures and exact selected excerpts.
This is a static old-test audit, not a candidate replay. No old file was edited.

## Zero-job assertions are not blanket parse-first rules

No canonical assertion requiring **all syntax to be parsed before every active
regex job** was identified in this bound cohort. Do not invent such a conflict or
turn every old zero-job expectation into one job. The concrete nearest assertions
are narrower and remain valid under encounter order:

| Assertion path | Exact input / selection | Disposition |
| --- | --- | --- |
| `tests/commands/expr/diagnostics-regression.test.ts:50` | Filters fixture IDs starting `skip`, at lines 44 and 47. Regex inputs are `["kept","|","match","abc","[","extra"]`, `["kept","|","match","abc","["]`, `["0","&","abc",":","["]`. | All regex branches are inactive; retain zero requests and existing diagnostics. Fixture paths: `tests/commands/expr/diagnostics/cases.ts:39`, `:71`, `:72`. |
| `tests/commands/expr/regex-lifecycle.test.ts:75` | `["1","|","match","","["]`, `["0","&","",":","\\("]`, `["1","|","match","x","a**"]` at line 69. | All skipped; retain zero workers. |
| `tests/commands/expr/inactive-prefix.test.ts:112` | Nine malformed inputs at lines 98–106, including `["1","|","match","abc","[","x"]` and `["1","|","substr","match","abc","[","1"]`. | All regex branches are inactive; retain zero jobs and exact syntax/arity errors. Full nine inputs are in the captured excerpt. |
| `tests/commands/expr/inactive-prefix.test.ts:160` | Ten limit inputs at lines 145–154, including `["1","|","length","abc"]` with `maxNodes:3` and nested inactive prefixes with `maxDepth:2`. | No active regex operand; retain zero jobs, structural limits, and exact refusal tuple. |

The diagnostic fixture's `class-parenthesis-not-capture` input
`["(",":","[(]"]` (`tests/commands/expr/diagnostics/cases.ts:56`) does not
contain an active colon operation: `(` opens a group and `:` is its operand;
the next token is the wrong close. Retain its syntax diagnostic. The quoted
positive control `["+","(",":","[(]"]` at line 74 is a real regex operation;
do not conflate them.

## Separate expectation version, if later authorized

Use the pre-candidate `independent-encounter-v2-prefreeze` controls plus the exact
unchanged 61-case expectations; preserve old evidence and denominators. For
active completed regex operands, the **existing** original driver assertion is
`freeze/original-driver.mjs:117` (submission count), not a new waiver:

- `["a",":","a","x"]`: one regex submission, then exact trailing-token syntax.
- `["(","a",":","a"]`: one submission, then exact missing-close syntax.
- `["a",":","[","x"]`: one submission, invalid-regex error, not trailing syntax.
- `["match","(","a",":","a",")","("]`: one submission, then missing argument.

Their zero-job observations in historical and current baseline captures are RED
product behavior, **not old expected values to replace**. A future owner should
version a genuinely conflicting old assertion separately only after naming its
exact input/path; this audit does not authorize any canonical test changes.

One implementation-sensitive family merits explicit replay rather than silent
relaxation: `tests/commands/expr/inactive-prefix.test.ts:164` injects exhaustion
at the third `Budget.yield` and asserts exactly three checkpoints at line 174.
The six cancellation variants at lines 191–208 inject at that same ordinal and
assert exact caller reasons, zero writes and zero jobs. All use
`["1","|","length","abc"]`. A parser refactor may move traversal checkpoints;
the safety obligations remain, and any separately approved expectation revision
must preserve those obligations without treating inactive values as evaluated.
No assertion failure is claimed here without candidate execution.

The historical old-cap assertion is independent: `["1","x"]` with
`maxOutputBytes:1` still expects status 2/full syntax output in the copied
`freeze/original-cases.json` oldCap entry. This baseline remains status 3/output
limit; it is retained RED separately, not repaired by sequencing or conflated
with the parallel quota work.
