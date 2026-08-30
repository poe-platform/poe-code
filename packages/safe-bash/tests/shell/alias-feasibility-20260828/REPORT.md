# Alias/dotglob feasibility — design only, 2026-08-28

## Binding and finding

`SOURCE-BINDING.json` pins sources, ownership, GNU URLs/sections [G0–G6],
and exact recipes/outcomes from `17735a5eabf65a6398a64aef81e67fee2405733e`.
Historical candidate e33974b8 versus just-bash **3.4.2**, not latest/current parity:
`alias-positive`, `unalias-positive`, `shopt-positive` returned ours127/baseline0;
unalias stopped at prerequisite alias. All six captured VFS effect lists are empty.
No rerun, native execution, product import/test, or XAN work occurred.

Root's published ledger accepts CD464 through2585f78d/192ab78b; current runtime
also contains **unaccepted LETc26892c3**. Inspected sources are clean; the initially
modified ledger was committed concurrently. CD464 is a component reference, not certification of today's
whole tree; root must pin implementation inputs after Raman's review, then
coordinate Poincare's stack window.

**True read-time aliases cannot retain universal whole-script preflight.**
However, inspected CD464 already interleaves `Shell.exec`, `runCommandString`,
stdin, source and eval read-units. `scriptFile` instead collects every AST before
execution; `parseShell` parses everything. Thus the premise is entry-point-specific.

## GNU facts, not native proof

GNU Reference Manual edition/version **5.3**, updated May18,2025 [G0]: aliases
replace unquoted command-position words by re-read shell syntax, including
operators—not runtime argv rewriting. Replacement first words expand again;
active aliases suppress self/recursive re-expansion. A final blank (space/tab)
enables checking the following command word [G1].

Reading covers a complete logical line and complete compounds/functions before
execution: semicolons do not activate definitions; subsequent read-units do.
Function bodies expand at definition-reading time. Noninteractive expansion is
off until `shopt -s expand_aliases` affects a later read, including nested eval
[G1,G3]. Default non-POSIX command substitution generally defers alias expansion
until execution; POSIX differs [G6].

`alias name=value` defines; no operands/`-p` lists reusable definitions; names
query, with missing names failing. `unalias names` removes; `-a` clears;
missing names fail [G2]. `shopt` needs real set/unset/query/list/status behavior,
not success stubs [G3]. These three builtins and alias/option state are absent
from the inspected accepted source.

## Proposed decision, requiring future approval

1. **Smallest independent change: dotglob.** No existing option field exists.
   Reuse `Runtime.glob`/`compilePattern`, changing the per-segment leading-dot
   filter at expansion time. Keep sorted/unmatched behavior and VFS budgets.
   Current filter lacks explicit `.`/`..` exclusion; exclude these wildcard
   candidates, consistent with Bash5.3's default globskipdots, without rejecting
   literal path components. Dotglob alone never makes ordinary wildcards match
   them [G3,G4]. No GLOBIGNORE/extglob/globstar expansion.
   Propose only dotglob/expand_aliases, initially off, with `-s/-u/-q/-p`, listing,
   invalid-name failures and explicit rejection of unsupported shopt modes.
2. **Preferred alias route: bounded read-unit lexical expansion for supported
   syntax**, not full Bash. Reuse parser boundaries—not physical-line splitting
   across quotes, continuations, heredocs or compounds. Add token-origin frames,
   trailing-blank eligibility, active-name guards, replacement-byte/token/work
   bounds, cancellation checkpoints and diagnostic/source-map accounting.
   `parser.ts` contains Lexer; no separate lexer file exists.
3. Whole-input alias snapshots can preserve preflight but are explicitly
   restricted; the captured eval recipes cannot distinguish that shortcut.
   Selectively pre-executing known builtins invents/suppresses effects: reject it.

Future paths: `src/shell/{parser,runtime,shell,types,display}.ts`; pattern/input
and invocation contracts are coordination dependencies, not granted edits.
Add owned alias-map/options to typed State/cloneState: functions/source/eval share;
subshells/pipelines/substitutions clone; processState/new exec initialize fresh.
Keep literal invoke alias-free. Existing substitutions store ASTs: deferred
reading needs representation review. Preparsed functions must not re-expand;
caller-owned ASTs bypass expansion; public Shell.exec accepts strings only.

Root must approve scriptFile's preflight loss, AST/API/budget choices, supported
shopt/profile boundaries (no POSIX parity claim) and inventory updates. Preserve cleanup admission,
shared budgets and abort precedence. Future independent checks must cover
timing, replacement syntax/positions, recursion, cloning, error-before-effects
boundaries and hidden-file effects. No implementation permission or acceptance
is implied.
