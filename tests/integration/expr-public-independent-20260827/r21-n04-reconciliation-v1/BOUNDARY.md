# Bounded reconciliation before fixture changes

Authorization: August 28, 2026; historical directory names remain unchanged.
Owner: substantive independent expr reviewer, this subtree only.

Read-only inspection authenticated v5 evidence commit
`7b68a7b2866217a21d52ff8b99dcab166f83f5ae`, manifest
`b8605b3dfe7d35723d6d24627a797edb0a60165e614c5800e54ffba4e0ff08f1`,
seal `0a37b5795ac594f1a1e587786295bb0dd21019162b3c76cfff3607fec6c232b1`:
993 raw entries, 220703859 bytes. No product invocation occurred during inspection.

## R21 static reconciliation

Pinned candidate `44f00bf84278e3361b52106478d59c707ab7b2bc`, not mutable HEAD:
`src/shell/runtime.ts:1572` rejects literal arguments containing NUL before
the nested isolated command/registry dispatch at line1603/line990.
The outer command catch at lines594–611 writes the shell diagnostic and maps
an ordinary TypeError to status1. `src/commands/expr/index.ts:22` instead calls
`Budget.arguments()`; `src/commands/expr/internal.ts:83` rejects NUL with
ExprError and lines84–90 reject lone UTF-16 surrogates. The expr handler writes
its own diagnostic and maps ExprError to its default status2. These are different
admission boundaries, not evidence of native OS argv/NUL parity.

The actual frozen component cases contain EXACTLY two R21 subcases:
`["bad\u0000arg"]` and `["\ud800"]`. There is no low-surrogate variant to invent.
The frozen expression runner asserts the first result before entering the next
variant. Thus v5 proves only the initial public status1; its assertion did not
retain stderr. The surrogate result must not be inferred from that run.

New observations will use the same root agentCommands plugin and literal
CommandContext.invoke wrapper. After plugin setup, the installed expr definition
is replaced deliberately by a transparent counting delegate. Direct observations
use the public createExprCommand factory and the same counting boundary before
definition.execute. Each of the two inputs at each boundary gets an independent
child; no old-expectation assertion can short-circuit its sibling. Known-valid
delegation and distinct command-name admission negatives qualify the observer.
R21 observations record exact input code units, dispatch count, exit, stdout and
stderr bytes. They do not score or amend the original R21 expectation.

## N04 prerequisite verified before amendment

All four authenticated N04 stdout receipts contain exactly one diagnostic:
`<layout>-N04.ts(11,32): error TS2561: Object literal may only specify known properties, but 'maxRegexSteps' does not exist in type 'Partial<ExprLimits>'. Did you mean to write 'maxRegexStates'?`
stderr is empty; compiler exit2 is natural. Combined has exactly six diagnostics,
the same N04 occurrence and the five unchanged line/code pairs
5/TS2353, 7/TS2353, 9/TS2322, 13/TS2322, 15/TS2322. No unrelated errors.
Matching full raw positive traces resolve virtual-bash to package dist/index.d.ts
and virtual-bash/commands/expr to package dist/commands/expr/index.d.ts in EACH
actual installed/moved Node22/24 layout. Input/declaration hashes are retained
in the authenticated inspection artifact, not inferred from current source.

Only NEW versioned N04 and its combined occurrence may expect TS2561, at the same
filename/line/column/field/type and exact full message. Original 32pass/8fail raw,
all original fixtures, nine-freeze, addendum and v1–v5 stay unchanged. New targets
retain original compiler flags (neither target originally used traceResolution).
Four separately declared positive TRACE binding controls cover fresh layout
paths with the unchanged v5 64MiB spool ceiling and separate 1MiB preview budget.

## Preparation disclosure

Read-only exploratory filename guesses runtime-cases.mjs and expr/expr.ts did
not exist; rg/git reported that fact. Actual paths were then read from pinned
trees. These were not product attempts, test passes or retries. No engine audit,
native oracle, full104 replay, HTML, DU29, TAP or fullgate was executed.
