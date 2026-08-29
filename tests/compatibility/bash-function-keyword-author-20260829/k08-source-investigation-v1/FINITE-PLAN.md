# Finite future proof plan (all new controls UNRUN)

Freeze independently before a successor implementation. Keep old K08 inputs/expected bytes and current51/54 result immutable. No build/test/native authority is implied.

- P01 exact K08 keyword +legacy scripts, expected done/status0 unchanged, across source-built/installed/physically-moved.
- P02 top-level set --3 and $1 -1, eliminating recursion as a prerequisite.
- P03 nested functions +caller restoration with different positional values.
- P04 $0, $9, 10, and $10 lexical distinction; empty/missing positionals.
- P05 signed, whitespace and expression-valued parameter text; 1+2 with multiplication exposes incorrect atom-substitution.
- P06 repeated spans in one expression and multiple active expansions; one preparation/evaluation per active expansion.
- P07 ordinary double-quoted parameter and single-quoted whole arithmetic literal unchanged.
- P08 unselected shell branches do not prepare/read parameters; active arithmetic pre-expansion occurs before arithmetic short-circuit evaluation.
- P09 nounset failure reason/line identity and missing-vs-empty distinction.
- P10 parameter value containing $(), backticks, semicolons or invalid tokens is never executed/rescanned as shell code; no new VFS effects.
- P11 parameter text forming a named lvalue uses existing readonly/checked writes; never writes a positional slot.
- P12 maxExpansionBytes just-below/at/above substituted length, pre-concatenation admission, and unchanged arithmetic64-depth/10,000-step/int64 behavior.
- P13 caller abort identity and bounded scanner checkpoints; no promise of preempting synchronous BigInt/flat primitives.
- P14 arithmetic command status/error context versus fatal arithmetic substitution; no LET quoted-operand policy change.
- P15 retained core/parser/runtime/fatal/readonly/substring groups listed in README, fixed test IDs before execution; no whole suite or new native oracle.
- P16 loaded mutants: bypass the pre-expansion phase, incorrect grouped-value substitution, and omit expanded-byte admission; sourcehash/moved/type controls under fresh grant.

ROOT must separately approve exact executable counts/resources and a different reviewer. This list contains proposed proof families, not passes or new native goldens. Any genuinely ambiguous missing/quote/nounset sequencing needs a small separately authorized native/source qualification rather than invented expected data.
