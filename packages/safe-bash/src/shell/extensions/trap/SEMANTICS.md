# Trap source leaf: current qualification

The executable leaf is `src/shell/extensions/trap/index.ts`. Explicit source
consumers pass `trapExtension()` in `ShellOptions.extensions`. The explicit local
optional build also exports this factory and its configuration types. There is
no default registration, default implementation import, or published npm subpath.

Root qualification passes 184 focused trap tests with the pinned Bash 5.2.37
oracle, fourteen actual compiled/public-consumer tests, and strict consumer types.
A broader run before the final generic factory-receiver regression passed 760
trap and existing shell tests. Actual EXIT/ERR/listing output was visually
inspected. These are scoped live-worktree checks, not a full Bash or release gate.

Independent review first reproduced stale pipeline ERR command reporting,
missing DEBUG arithmetic/conditional delimiters, and mixed-runtime byte failures.
The repaired extension declares runtime affinity; coherent compiled byte actions
and forks pass, and source-bound extensions are rejected by a compiled host.
Root also reproduced a class-private factory receiver failure. Capturing a bound
factory preserves the original receiver while an immutable token snapshot remains
authoritative for admission and forks; the reviewer approved the contract and its
getter-count assertion. No global byte brand or weakened ownership was introduced.

## Lifecycle and grammar

The leaf implements installation, removal, empty ignored actions, quoted
byte-preserving `trap -p`, `trap -l`, numeric reset operands, signal aliases and
EXIT/ERR/DEBUG/RETURN events. Actions are evaluated late in their shell scope.
Function/source/subshell/substitution/pipeline/process boundaries are distinct.
Ignored dispositions inherited by a child process cannot be rearmed there.

`errtrace`/`-E` and `functrace`/`-T` are opt-in instance options. The extdebug
option enables/disables tracing and implements DEBUG command skipping and
function/source return on status two. DEBUG exposes interrupted command spelling
and line numbers for the qualified grammar. It does not recursively invoke
itself. Nonzero handler status does not generally replace interrupted status;
explicit exit and errexit remain shell control flow. EXIT evaluation expansion
failure preserves the original exit status. Resource disposal is never EXIT.

**This is not full trap completion.** Function trace attributes (`declare -ft`)
are not connected because the shell has no declaration-attribute interface.
Extdebug's declaration-location and BASH_ARGC/BASH_ARGV debugger metadata are not
implemented. Unsupported surrounding shell syntax (including select and
arithmetic for) is not made available by this leaf. Named signal delivery below
does not establish OS job control or interruptible background/wait semantics.

## Explicit virtual signal host

Without a `signalHost`, the builtin stores/lists named dispositions but receives
no signals. It never installs native process-global signal handlers. The default
name/number catalog uses Node's platform signal metadata (plus Darwin EMT).
`signalNames`, when supplied, replaces that catalog completely. Numeric pseudo
events follow the catalog's highest number. This is an explicit virtual catalog,
not a claim to reproduce every host's realtime-signal numbering.

`signalHost.subscribe(deliver, scope)` registers a receiver for one opaque shell
scope and returns an awaited unsubscribe callback. `deliver` returns true only
for an active handled or ignored named disposition. Invalid, unhandled,
uncatchable KILL/STOP and pseudo signals return false. The host owns unhandled
and default dispositions; false does not terminate or cancel a shell.

Pending identical signals coalesce and handlers run at cooperative command/error/
termination safe points. This callback is not a synchronous signal-handler
execution promise and does not interrupt opaque blocked host commands. Cleanup
closes delivery admission before awaiting unsubscribe. Root cancellation and
budget failure reject execution; neither is converted into successful EXIT
completion. Host signal delivery and root cancellation are separate mechanisms.

## Evidence, September 4, 2026

Native tests require both `SAFE_BASH_TEST_BASH` and
`SAFE_BASH_TEST_BASH_SHA256`. With both absent, only native comparisons skip:
66 tests pass and 118 are explicitly skipped. Partial, malformed, unavailable,
wrong-version or hash-mismatched prerequisites fail; no system Bash fallback is
used. Modern qualification used GNU Bash
5.2.37(1)-release, aarch64-apple-darwin25.4.0, built by the root coordinator from
the official archive, executable SHA256
`f5b331844c67482075aea7883153127668cc67f83a60a7b4362cc8469a9dc77d`.
Native execution uses a closed PATH. Five lifecycle fixtures explicitly invoke
the selected `$BASH` executable for child shells; other fixture source is unchanged.
All product fixtures are in memory; native programs are test oracles only.

Initial `/bin/bash` 3.2.57 observations remain relevant but are not modern
qualification: that oracle unwound function locals/arguments before EXIT,
omitted natural pipeline EXIT, hid subshell inherited listings and restored
sourced DEBUG actions differently. The modern leaf intentionally follows the
5.2 observations for these cases. The earlier unbound run reproduced fourteen
failures against 3.2; the explicit oracle admission now rejects that version.

A RETURN action that unconditionally executes `return` recursed indefinitely
in both native versions and hit the test supervisor's timeout. The bounded
regression removes RETURN before returning; virtual recursive evaluation is
still subject to command/source budgets rather than an unbounded native loop.
