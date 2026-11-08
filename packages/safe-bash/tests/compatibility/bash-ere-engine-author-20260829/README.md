# Standalone ERE engine author handoff

2026-08-29. **Author-tested internal engine; independent review required.** This
does not enable `[[ =~ ]]`, add a public export, change expr, or constitute native
POSIX/Bash acceptance. No Worker/transport/publication code changed or executed.

## Exact candidate

- Final source commit: `f97fd06024cb63edfd01873d81d84576a22189db`.
- Five-file canonical projection SHA256:
  `dd11bbbab8247a59f503776b1ddb09e496cdd0caeb77d09425001bdc4ba84a77`.
- Final executable seal SHA256:
  `b789cb4193d8a1ea4bde54180edd5f27c5d57fe5b58ed002aac5fedaf6c86440`.
- Baseline authority: accepted Unit3 source
  `7a5c620005fb04518d44bb284f4e99284e4a7c33`, derived
  `74dfe69135a3fc5ba89396b20dd32d9c9daae131`.
  The standalone five files import only each other and Node's timers builtin;
  this is not a reconstructed293-input/full954 package or moving-HEAD claim.

Exact per-file size/mode/SHA, actual Node binary, complete compiler/type closure,
emitted declaration/JS witnesses, every layout load and postrun census are in
`SEAL-v3.json`, `ACTUAL-03/RESULT.json`, and `DATA-SYNTHESIS.json`.

| Product file | SHA256 |
| --- | --- |
| types.ts | b8401fe06db29726ce989390d445138b26912c946eb64cac013f8ff2a2e91f2b |
| errors.ts | 9496bc26dbe7866451fedf13ea2c25de9837f88331f208bf27f4f6edff1ec38c |
| limits.ts | ab7a87c37449dc7184ce530840f90c25ae3f48fb60204a3f6bd3d07c5d2146af |
| syntax.ts | cf928a8e09a2fbe4bdd67c187849e40bde1d02e9eb1e79f509827b0a2f5cde6d |
| matcher.ts | d9eb7ec7b18648ddcbd853085aef6972cd5938d3817df458796b0a7354b0abeb |

## Internal API and behavior

`deriveEreLimits(bounds)` and `new EreLedger(bounds, lowering?)` derive private
allowances from explicitly supplied maxExpansionBytes/maxExpansionFields. Lowering
cannot raise any ceiling. `compileEre(stringOrLiteralFragments, ledger, signal?)`
returns an immutable handle bound by WeakMap to that ledger/module instance.
`matchEre(program, subject, ledger, signal?)` asynchronously returns complete
immutable captures0..N, with null for nonparticipation and explicit empty spans.
Values use empty strings for unmatched captures. Search picks earliest start,
longest whole match and compares numbered-group chronological capture histories;
it does not keep the first traversal on a whole-length tie. No JS RegExp runs.

Supported profile: non-NUL ASCII C/POSIX; literals, literal-origin fragments,
dot (including newline), original-subject anchors, alternation/groups, ordinary
brackets/ranges and twelve ASCII classes, `* + ? {m} {m,} {m,n}`. Syntax and
unsupported-profile errors are distinct classes, both future status2. Unsupported
includes nonASCII/NUL/surrogates, backrefs/escape extensions, special groups,
collating/equivalence elements, stacked repetition, captured nullable repeats
with maximum>1, repeated anchors and grammar ceilings. No native stderr goldens.

| Private resource | Ceiling / accounting |
| --- | --- |
| patternBytes | min(B,65536), per-input high-water admission |
| subjectBytes | min(B,1048576), per-input high-water admission |
| work | min(50000000,32B), cumulative |
| states | min(65536,8F), cumulative admitted states, not peak states |
| allocationUnits | min(4000000,8B+128F), cumulative logical retained storage |
| captureBytes | B, cumulative complete returned capture-string bytes |
| captureSlots | F, cumulative complete returned vector slots |

B/F are nonnegative safe integers; derivation saturates before unsafe products
or sums. Zero is not raised. Grammar caps are4096 nodes,64 parser nesting levels,
32 groups,interval operands0..255. Group ceiling can be reached before depth64.
Private exhaustion throws EreProfileLimitError(status3), never a fabricated
ShellLimitError. Known admitted charges are retained; markUnknownUsage permanently
poisons subsequent work and preserves its cause. Caller reason identity wins
over poison, including falsy reasons. Checkpoints yield via awaited setImmediate
at charged intervals; this is cooperative bounded work, not hard preemption.

## Actual author validation

Final ACTUAL-03: **66/66 groups in each layout**,198 layout outcomes. Each has
50 literal/profile vectors +13 limit/cancel/binding protocols +3 property groups.
The property groups contain155 literal searches,4 alternative-order cases and
1524 ASCII-class comparisons; these are nested checks, not extra independent
groups. Three strict positive consumer checks pass; three negative checks each
produce exactly TS2345/TS2339/TS2322 (nine diagnostics). One fresh strict build
includes all five source files with declarations.

Eight unique loaded mutation families killed, eight restored companions pass:
M01 first-tie, M02 ASCII bypass, M03 nullable-repeat bypass, M04 capture truncation,
M05 poison bypass, M06 capture-slot bypass, M07 final-vector/history collapse,
M08 ledger-binding bypass. DATA synthesis verifies exactly one changed loaded
module for each mutant and no changed module for positive/restored layouts.
L06 includes actual foreign-ledger and fabricated-handle refusals; these are API
binding controls, not a claimed hostile filesystem/loader sandbox test.

Layouts are source-build output, regular-file installed-artifact copy, and physical
move with old location absent. **No npm install or full package/root import proof.**
The role named source consumer uses the same emitted declarations as installed;
strict source compilation is separate, not a second independent consumer proof.
All eleven artifact members match across original and physically moved copies.

## Preserved history and resources

- Initial preseal/source `b81e6d5326e0d67dd417bb48890286e4f386f026`.
- ACTUAL-01: compiler TS2322, exit2,491 bytes, one retired child, zero engine tests.
  Tuple annotation correction `1bee32ecbb53b16fce65583ce18f96da44220d27` and
  SEAL-v2 preserve the original failed source/capture rather than rescoring it.
- ACTUAL-02:64/64 each layout,8 loaded kills/restores, six type executions;
  26 retired children,47,676 captured bytes,26,182,458 working bytes,4,675ms.
- Static followup then added charges for negated-set/composite/history loop work;
  L12/L13 are additive. ACTUAL-03:26 retired children,48,387 capture bytes,
  26,183,264 working bytes,5,998ms. Original64-group results remain separate.
- Total execution children53/53 known natural close; peak one execution child
  plus coordinator and command shell (three known processes). Zero Workers/native
  or private engines. Child raw capture sum96,554 bytes, excluding administrative
  tool transcript output. Final publication/admin counts are in HANDOFF.md.
- Later attempts use the first ACTUAL-01 directory birthtime minus1s to preserve
  the original45min deadline conservatively; no deadline reset. No safety,
  capture, integrity, timeout or unknown-retirement stop occurred. Original
  compiler failure is ordinary and all dependents were withheld until reseal.
- Retained untracked `ACTUAL-01/work`, `ACTUAL-02/work`, `ACTUAL-03/work` are known
  owned source/tool/emitted copies, not deleted. Raw stdout/stderr and results are
  committed explicitly; no broad staging or cleanup of foreign files.

## Independent review / hard gaps

Capture disambiguation is the highest-risk implementation: independently challenge
chronological histories, nested nonparticipation and repeated last-participating
groups (E12/E28), not only simple total-length ties. Author-selected model examples
are not GNU/libc evidence or a formal proof of all admitted POSIX ambiguity.
Exhaustive path search can refuse ambiguous/large inputs at private bounds; no
linear-time, superiority or benchmark claim. Logical allocation units exclude
temporary JS frames/promises/GC and input ownership; no RSS/combined-memory claim.

Future-only: invocation-root attachment across Shell/invoke, Worker reservation
and complete-reply validation, crash/timeouts and unknown-consumption accounting,
virtual locale resolution, actual shell fragment adapter, BASH_REMATCH visible
local/global atomic publication, readonly/exported/stale behavior, sink errors,
registered cleanup and public boolean/error mapping. Existing APIs/expr/Worker
protocols are untouched. No AST-cloning/cross-package handle guarantee is added.
The32 shell reference programs+8 host protocols remain **UNRUN**; no new native
observations, public `[[ =~ ]]` support, whole-package or whole-HEAD acceptance.
