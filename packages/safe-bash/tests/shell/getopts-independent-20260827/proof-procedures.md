# Frozen execution procedures — NOT EXECUTED

These are opt-in, candidate-specific audit procedures. Nothing here is a current
canonical test, a public package export claim, or authority to start execution
before root explicitly resumes this reviewer after the freeze commit.

## I01 — identity and chronology

Resolve candidate `157d78c957b56f83f6e705fc35da60b1f2ea3a9b`, author profile freeze
`10291e716fefb939a7d1f4ffed5b24591fd1b664`, and author evidence
`a03b9288a6f4b652387be9fefa8faf17ef58b9e7` from Git objects. Record tree IDs,
commit metadata and ancestry. Resolve this independent freeze by its reported
commit, not whatever HEAD is when execution resumes. This freeze is deliberately
AFTER the source commit but BEFORE independent source inspection or execution.

## I02 — task-owned immutable committed archive

Create a unique directory only below this task's owned directory. Export the
candidate's committed tree there, never current worktree product files. Do not
create branches/worktrees, modify live product, or use an author's leftover build.
Record exact Git archive command, archive SHA256, full member inventory and source
blob identities. Record hashes of every regular file, symlink target and entry
type. Reject unexpected symlinks/path escape before loading code. Build/capture
outputs go in distinct siblings, never the source archive. Compare the complete
before/after inventory, including new entries, not merely originally known files.
Unrelated live changes neither enter nor veto committed-archive execution.

The expected scanner SHA256 declared by the author is
`bf0bcfd9f370861504e9561c54cfd12c8706663ee7dc3ca8a28b70f66290e9ee`.
It was not independently read/hash-checked before this freeze. Verify it after
resume; an identity mismatch blocks execution rather than silently rebasing it.
Read only the committed scanner/import graph for review. Do not inspect Sagan's
live `src/shell/runtime.ts` or `src/shell/shell.ts` for this bounded assignment.

## I03 — actual source execution and inventory

Use an authenticated explicit development TypeScript loader, with cache disabled
and temporary/cache paths task-owned. Record Node, loader, TypeScript versions,
resolved paths and relevant hashes. Compile/typecheck actual candidate inputs,
not a reimplementation. Development tooling may be referenced from installed
tooling without importing live product files; record that prerequisite and
dependency inventory. No installation, private package, or network dependency
fetch is authorized by these procedures.

The future audit harness takes an explicit candidate module file URL and imports
that exact archived `src/shell/getopts.ts`; record realpath, hash, import/load log,
and source root containment. Do not read an expected-result JSON instead of
calling the four real APIs. No source-reading or candidate-loading code is part
of this first phase. Run all frozen semantic projections and policy matrices;
record every operation, input, expected value, actual value and failure reason.
Counts of sequence controls, scan assertions and policy subcases stay separate.

## I04 — compiled and relocated INTERNAL module

Build isolated ESM plus declarations from committed source with strict NodeNext,
ES2023, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and
`verbatimModuleSyntax`. Use explicit private scanner/import closure as the owned
build set; separately inventory the candidate's tracked maintained consumer/test
inputs before making any broader qualification. No shared `dist`, root build,
root exports or package edits are permitted.

Create a task-owned staging package using the candidate's actual package identity
`virtual-bash` and actual relevant metadata, preserving its private/non-exported
status. Copy only emitted runtime/declaration closure and necessary package
metadata, manifest every byte, then physically move the package to a distinct
consumer root. Keep compiler inputs/build directory inaccessible to the consumer
by path isolation and module-load allowlisting, not by editing foreign files.
Run a child Node process without tsx, TS loaders, tsconfig paths or `NODE_PATH`.
Import the moved `dist/shell/getopts.js` by explicit file URL (or record the
equivalent private build layout), NOT a fabricated public package subpath.
Authenticate `require.resolve`/URL and load logs; rerun all semantic controls and
applicable policy controls against those moved bytes. Retain package manifest,
emitted hashes, move evidence, invocation and raw output. This is private internal
module acceptance, not proof that normal package exports expose `getopts`.

## I05 — strict type probes

Materialize `type-probes.json` data as explicitly listed `.mts` consumers in an
isolated folder whose `candidate/getopts.js` resolution is bound first to the
committed source/declarations, then to the relocated emitted declarations. Do not
rewrite the frozen code to fit the candidate. Positive prelude failures block all
negative claims. Store each negative's diagnostic and expected reason separately.
No `any`, assertion casts, suppressed diagnostics or `skipLibCheck` may hide the
consumer incompatibility. Any tooling prerequisite failure is not a product pass.

## I06 — native development holdouts

Use these separately authenticated original Darwin profiles:

| Profile | Recorded binary | Expected SHA256 |
| --- | --- | --- |
| Bash 5.3.0(1)-release | `/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash` | `8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c` |
| Bash 3.2.57(1)-release | `/bin/bash` | `35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3` |

No binary was accessed or run in the freeze phase. Hash and record version,
platform/architecture and invocation before running scripts. If unavailable or
different, record blocked profile; do not substitute `/bin/bash` for 5.3 or call
Darwin results Linux evidence. Run 12 script selections separately per available
profile. Bash 5.3 is acceptance; 3.2 remains a distinct historical comparison.

Each invocation is literal argv:
`<binary> --noprofile --norc -c <native-holdouts.sh exact UTF-8 text> getopts-independent <N01..N12>`.
Supply only explicit `PATH=/usr/bin:/bin`, `LC_ALL=C`, `LANG=C`, `TZ=UTC`, and
task-owned `HOME`/`TMPDIR`; do not inherit `BASH_ENV`, `ENV`, `SHELLOPTS`,
`BASHOPTS`, or ambient credentials. Set cwd to unique task-owned scratch. stdin is
closed; native scripts perform no filesystem/network work. Dev subprocess capture
is permitted, not product process execution. Apply a 2500 ms deadline and 128 KiB
per-stream output cap, await child exit, and retain exact stdout/stderr Base64,
status, signal, timing and child cleanup. An external timeout is not an end result.

`observe` emits five NUL-delimited fields per call: status, option, OPTIND,
OPTARG-set marker (`x` or empty), and raw argument value. NUL cannot occur in Bash
strings. Empty and unset are distinct; embedded newlines and UTF-8 survive.
Match every call in the order of `nativeControls.semanticIds`, omitting explicit
index events from the emitted records. Compare whole stderr exactly to the frozen
per-script stderr strings. Projection onto scanner diagnostic intent is explicit;
the helper itself performs no stderr emission. No trailing fields may be ignored.

The observation helper uses no local OPTIND, no declarations that restore cursor,
and no `set -e`; returning from `observe` does not turn an EOF into script failure.
The observed option variable is `option_name`, never OPTIND/OPTARG. The literal
wrapper's own positionals are not used as a positional-restoration oracle.
Required Unicode values are comparable as UTF-8. Lone-surrogate JS strings,
limits, cancellation, clone ownership, and root's stronger readonly policy have
no native projection and are not counted as native holdouts. N07/N08 numeric
assignment events exercise primitive mapping only, not implemented runtime hooks.

## I07 — discriminating negative and mutation runs

Follow each M01–M16 target and acceptance rule in `policy-controls.json`. Patch
only disposable owned candidate copies with `apply_patch`. Record the target
control's first meaningful assertion failure, not just nonzero process status.
An inapplicable mutant must be reported, not counted as killed. Run controls on
the original authenticated candidate before and after mutant batches. Verify the
original archive full-entry inventory still matches. Mutation does not authorize
product changes. Genuine bugs go to root with minimal reproducer and scope.

## I08 — evidence, cleanup and stage boundary

All captures use fresh uniquely named output directories under the owned tree;
no committed fixture or historical archive is rewritten. Inventory source,
emitted package, test harness and fixtures independently. Report original frozen
denominators, executed/failed/blocked/not-run counts, exact artifact hashes and
external-oracle availability. Keep oracle/historical data explicitly classified;
do not omit whole test trees from typechecks to make a gate green.

Close all harness children, timers and listeners and observe late callback
rejections. An uncooperative host promise need not be forcibly settled, but must
not keep scanning alive or create an unhandled rejection. Record cleanup limits.
Stage 2 remains WITHHELD: no variable binding, readonly bypass/removal, assignment
origin/local-function/subshell restoration, middleware/invoke lifecycle, actual
shared-shell-budget integration, registration or default-command count increase.
The private scanner does not establish full getopts/native parity or superiority.
