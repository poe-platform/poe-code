# Bounded egrep/fgrep author evidence

## Scope and candidate

Ownership: new `src/commands/grep-aliases/**` and
`tests/commands/grep-aliases/**` only. The one explicit out-of-repository artifact
is the requested `/tmp/safe-bash-alias-api.txt` proposal. No existing product,
root export, package/default, shared grep/regex, AGENTS, private checkout, oracle
golden or other owner's test file was edited. No dependencies were installed.

Initial inspected HEAD was `4d524fd8d8c7f0bfbafba625778e8fa4550acf5f`.
Other owners committed while this author worked; the first sealed validation
used HEAD `b871222100d0453a570b80fa7b41b1181be8eb67` plus these new untracked files.
That is a dirty-worktree author candidate, not a frozen whole-repository gate.
`author-evidence.json` records the exact validation commit, full status, all
source `.ts` hashes, owned canonical TS/MTS/MJS hashes, configs, lockfile, native
capture hash and built worker hash. `HANDOFF.md` identifies the later committed
source candidate. Source SHA-256 for `src/commands/grep-aliases/index.ts`:
`61da567865598900545a4bbff2184ce5c68eb0c7e0347e7236e9f92789372c0a`.

## Author checks

`node tests/commands/grep-aliases/verify-author.mjs` records these four checks,
each with exact argv, exit/signal/error, output hashes and raw output files:

1. `npm run build` (builds package source, not a whole-package test gate).
2. `node_modules/.bin/tsc -p tests/commands/grep-aliases/tsconfig.json` (strict
   NodeNext source/test/helper checks plus the maintained built-module consumer).
3. `GREP_ALIASES_NATIVE=1 node --import tsx --test tests/commands/grep-aliases/aliases.test.ts tests/commands/grep-aliases/safety.test.ts tests/commands/grep-aliases/native.test.ts`.
4. `node --import tsx tests/commands/grep-aliases/consumer.mts` (runtime consumption
   of the built **internal** module, not an unapproved package export).

On Node v22.22.2 / Darwin arm64 all four pass. The test cohort is 119 total:
118 pass, zero fail, one explicitly skipped GNU-prerequisite test. It comprises
42 wrapper/invocation/profile tests, 25 safety tests, 50 native-derived cases,
one pinned BSD replay and one unavailable GNU replay. Without native opt-in the
117 product tests still run; both live replay tests are explicit skips.

Safety checks include both alias names, real Shell invocation and literal argv,
standalone registration without grep, collision preflight/replacement, cleanup
registration before acquisition, abort-before-open, active-worker abort and
retirement, opaque stdin/stdout cancellation and late rejection, producer Buffer
reuse/finalization, sink backpressure, early-return finalization, input/sink
failure diagnostics, no host RegExp construction, shared worker/queue limits,
capacity release while a sibling's sink is paused, and configured request timeout.
The safety process instruments actual workers: 24 created, 24 exited, zero active
at its after-hook. This count is scoped to that instrumented process, not every
worker in every test process.

No broad package test, old comparison, du, performance/superiority, service,
or full-candidate release gate was run. No unrelated baseline failure was found
by these successful commands; this is not a claim that unrelated suites pass.

## Independently captured native corpus

`native-bsd.json` is the native-only author capture. Inputs are canonical
`native-cases.ts`; output tuples are status plus exact base64 stdout/stderr.
No native process executes in product code. Capture uses a fresh owned `.native-`
directory and fresh subdirectory for each fixture, explicit environment
`LC_ALL=C LANG=C TZ=UTC PATH=/usr/bin:/usr/bin:/bin`, no ambient grep options,
3-second synchronous child timeout with SIGKILL, and a 1 MiB output ceiling.
Each child is reaped before advancing; only the exact created temporary tree is
removed in `finally`. Recorded capture/replay: zero timeouts, temporary removed.
There is no outstanding author-owned native process or fixture directory.

Pinned native version: BSD grep 2.6.0-FreeBSD, Darwin arm64 (not GNU/Linux).
SHA-256 `/usr/bin/grep` and `/usr/bin/egrep`:
`468ff46a0b9f0e88de268ce12640bfa37610d585f968127cf32cf4e86d5c70ab`.
SHA-256 `/usr/bin/fgrep`:
`2146bcefd5e202919805f0b47701e4216ba636b994f272447301918267460062`.
The live optional test refuses changed binary hashes, versions, platform,
architecture or corpus; it replays every raw tuple, including diagnostics.

**39/50 tuples match BSD exactly; 11/50 are explicit profile differences, not
native passes.** Differences are combined matcher flags (2), unsupported `-G`
(2), short missing-pattern diagnostics (2), invalid-option diagnostics (2),
quiet-before-later-missing-file diagnostics (2), and ordered ERE alternatives
versus native leftmost-longest (1). Each has a precise product expectation;
none is a blanket stderr waiver. The 50/50 native-derived product-profile checks
do not mean 50/50 native parity.

The original first-native run, retained in `first-native.tap`, expected two
quiet-before-missing tuples to be exact and failed both: BSD printed the later
missing-file diagnostic while both products stopped at their successful `-q`
match. `profile.ts` records this narrow qualification without changing the
canonical corpus, raw capture or shared product implementation. Original first
native run: 48 pass, 2 fail, 1 native-opt-in skip. Its shared source state was not
sealed, so it is investigative evidence, not candidate certification.

Early author checks also found two test-author mistakes: a nonexistent MemoryFS
`exists` method (replaced by a typed `stat` rejection assertion), and comparison
of Shell's null-prototype env to a plain copied object. The latter first runtime
cohort had 63/64 pass; corrected testing checks parent env identity and contents.
These were test mistakes, not shared product fixes or weakened native goldens.

## GNU prerequisite gap and verifier handoff

No genuine local GNU grep executable was found on PATH, Homebrew grep locations,
the repository, `/tmp`, or the observed local native temporary-tool directory.
**GNU native capture is not completed.** No dependency was installed to disguise
that prerequisite gap; the GNU test remains skipped by default. A verifier/root
with a local genuine GNU `grep`, `egrep`, `fgrep` can first inspect the launchers
and backing binary, then capture into a NEW filename (existing files are refused):

`node --import tsx tests/commands/grep-aliases/capture-native.ts gnu /absolute/gnu/bin native-gnu.json`

Replay with `GREP_ALIASES_GNU_NATIVE=1` and
`GREP_ALIASES_GNU_EVIDENCE=tests/commands/grep-aliases/native-gnu.json` alongside
the native test command. Explicit opt-in without evidence or changed recorded
identities fails rather than skipping. This replay asserts raw native stability;
it does not automatically classify GNU-to-product parity. GNU warning bytes
must remain in that profile and be counted separately; none are stripped here.

`native-cases.ts`, helpers, tests and the strict consumer remain canonical
TypeScript inputs. Native captured bytes are JSON/base64, logs are `.tap`/`.log`,
and temporary fixture files are runtime-created data, not TS-discovery exclusions.
The source README documents inspected module APIs, inherited limits and proposed
root exports. Root integration, different-agent stress/verification, and GNU
capture remain separate work. This bounded author handoff is not full product
completion, native parity, superiority or 72-hour duration evidence.
