# Eval and final current-shell author checkpoint

2026-08-27. Source/dot is the separate atomic commit
`917263291e90734d3db5414b7381419b5eec33a2`; see `source-dot-eval-source.md`.
This second semantic commit implements eval only, plus its own evidence.
The write lease was observed GRANTED before the first source edit. Neither
independent current-shell expectations nor the expanded-seven recipes were read.

## Eval behavior

`eval [--] [arg ...]` joins already-expanded arguments with one space, parses
the resulting text with the existing input-unit parser, and executes in the
same Runtime/State. No-argument/empty commands return0. Leading unsupported
options return2 with invalid-option/usage diagnostics; `--` protects command
text. No new grammar, expansion forms, startup files, host processes or ambient
environment are introduced. The inherited strict UTF8/control-byte text policy
is not native arbitrary-byte source parity.

Variables, exports, positional parameters, cwd, function definitions and options
use current state; caller function locals remain visible. Return propagates to
the active source/function frame; exit and break/continue propagate to the
existing boundaries. Subshells, pipelines and CommandContext.invoke keep their
existing isolation policy; eval does not secretly create a new shell process.
Dot/eval are POSIX special builtins; prefix assignments persist in sh, while
command-prefix suppression and Bash temporary assignments retain their existing
rules. A nonzero evaluated command does not by itself make a special builtin
fatal. The captured first-unit sh syntax error is fatal; errors after an executed
unit return2. This is bounded observed behavior, not universal diagnostic parity.

Outer argv expansion precedes eval; each resulting input unit parses before its
own command effects. Earlier complete units may act before a later parse error.
Source and derived eval text both charge aggregate UTF8 bytes to the caller's
budget. Commands, loops, depth, output and cancellation also share that budget.
Execution stdin and its origin/cursor are preserved, including finite binary
bytes; redirections use the existing descriptor and cleanup machinery.

## Exact results

- Before either fix, **0/84** primary source/eval assertions passed; retained
  unchanged in `source-dot-eval-red.json`.
- Source primary **48/48**, historical **41/48**, bounded host **1/1**.
- Eval primary **36/36**, historical **30/36**, bounded host **1/1**.
- Final new cohort **86/86** with zero skips/cancellations/TODOs.
- Unchanged legacy72 + author132 + corrected earlier author211: **415/415**.
- Global/build/benchmark `tsc --noEmit`: all exit0; **952/296/411** actual
  prelisted compiler inputs, none unguarded. No emitted JavaScript.

Both complete native profiles ran all42 sources × actual bash/sh argv0: **84
rows/profile**, total168 execution rows plus4 version calls. Primary is pinned
GNU5.3.0, executable SHA256
`8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c`;
historical is actual /bin/bash3.2.57, SHA256
`35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3`.
No /bin/sh substitution or per-case oracle selection. Capture helper details,
scrubbed environment, hard deadlines and same-coordinate VFS comparisons are
documented in the source report. Exact output bytes/status/file contents remain
in the committed captures and full raw comparisons; no stderr masking.

The seven source historical mismatches are bash late/same-unit syntax/missing,
and sh PATH fallback/late/same-unit syntax/missing. The six eval historical
mismatches are bash/sh late/same-unit syntax and invalid-option diagnostics.
These **13 new historical raw losses** remain nonzero comparisons, separate
from the previously open nine historical findings. No historical expectation is
used to waive a primary failure or rewritten to claim universal parity.

## Source and guards

| Runtime stage | SHA256 |
| --- | --- |
| starting b02bbe8, accepted discovery | `bb629885983de4169d8419c97f8d09be2ae1729841ae306675ce530cd8287d7c` |
| source/dot9172632 | `a11f04a315f05962984e2a2154140cce5222359e546f5b4f49cafe07536cbda7` |
| final source/dot/eval | `1d303091932cfca31e1c1b0de7e35609173db7bcd71cc2fb14fd5740faeb9491` |

Shell/BOM file remains SHA256
`4ac91162195c150848793c92b8b1e90f15a36e67b5ae8a2652fe7ed9dcf4fb5e`.
Only runtime.ts changes in production. Public exports, API names, contracts,
root exports, manifests, dependencies, command/FS/JSON helpers are unchanged.
The real builtin registry now reports source/dot/eval because they execute;
existing registered printf/custom command roles are not relabeled.

Node22.22.2, direct TS imports through tsx. Final load-hook records prove34
distinct product `.ts` dependencies for new/legacy tests, all matching endpoint
hashes. All five final run guards are stable; final cross-phase product hashes
also match. These are named snapshot results, not a current-clean-product or
transient-write/revert guarantee. Foreign work and index entries remain outside
the source author's explicit-path commits. No retry loop was needed.

`source-dot-eval-final-validation.json` contains exact commands, full TAP,
per-run exit status, compiler inputs, source/dependency hashes and import proof.
The reused native helper awaits child close, kills the detached group, and
removes each owned directory. Host probes have strict rejection handling and a
5s child deadline; all completed normally. Final recorded PIDs/groups and all
captured native directories are checked again at handoff. No watcher remains.

Official basis: GNU5.3 Bourne Shell Builtins manual and pinned
`builtins/eval.def` (argument concatenation and no-options handling), plus
POSIX.1-2024 Shell Command Language evaluation/special-builtin rules:
`https://www.gnu.org/software/bash/manual/html_node/Bourne-Shell-Builtins.html`
and `https://pubs.opengroup.org/onlinepubs/9799919799/utilities/V3_chap02.html`.

Reproduce using NEW evidence filenames:

```sh
node --import tsx tests/shell/source-dot-eval-native.ts capture eval /tmp/eval-native-new.json
node --import tsx tests/shell/source-dot-eval-native.ts compare eval /tmp/eval-compare-new.json
node tests/shell/source-dot-eval-verify.mjs final /tmp/current-shell-validation-new.json
```

Comparison exits1 for the retained historical losses. Validation writers retain
each child status rather than treating their own success as suite acceptance.
No first-read/custom5, old native9, paused NUL, jq, BOM or full-suite rerun.
The separate seven expanded recipes were not rerun: no claim that any of their
failures, including the four outside this batch, are independently closed.
Source-p, broad syntax, traps, dynamic scoping beyond existing functions,
arbitrary binary source, and native process/startup behavior remain limits.
Independent current-shell acceptance and full Bash/superiority are pending.

Final audit at02:17:08Z records18 validation/test PIDs and groups absent and all
168 captured native directories absent. Five frozen regression files remain
byte-identical to90cbf28. **After** the stable validation intervals, eight foreign
product files changed (diff-patch patch.ts, metadata stat.ts, four S3 files and
two WebDAV files); exact paths are in `source-dot-eval-final-audit.json`.
Consequently the validations are not certification of the final moving tree.
Shell hashes still match. These later changes were not edited, reverted or
rerun by this worker, and are not converted into an aggregate green claim.
