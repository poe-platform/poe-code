# #641: bounded parallel xargs

## Status and authority

Leaf implementation and focused verification, September 5, 2026. No commit,
push, build, release, shared registration or full-gate claim is made here.

Current issue read with:

```sh
gh issue view 641 --repo poe-platform/poe-code --json number,title,author,body,updatedAt,state
```

The issue is OPEN, authored by `kamilio`, last updated
`2026-09-05T18:43:32Z`. The current body requests bounded asynchronous xargs
invocation, an execution-family `maxParallelProcesses` option with a small
default, shared command/output/CPU budgets, cancellation propagation and no host
subprocess execution. The actual sequential-only rejection was re-read in current
`src/commands/execution.ts` before implementation.

Root selected these exact semantics: default cap four; positive safe-integer
configuration; per-xargs cap; absent `-P` sequential; positive N clamped to the cap;
`-P0` equal to the cap; first observed terminal status sticky. Root explicitly
requires browser execution-family opt-in, not default inventory expansion, and
preservation of the established public error/diagnostic boundary.

Started at clean `af9f1b23b660890c17f346fb6d44b8fe6060f179`.
The root qualification pointer is
`/home/kjopek/kamilio-validation-569-575.RoFXyZ/issues-635-643-final-gate.path`,
resolving to `issues-635-643-final-gate.QqebE8` under that base. Its qualification
record, dated `2026-09-05T21:43:20.077Z`, reports the maintained selected
virtual-bash build closure, 20,720 Bash passes, 279 runner passes, 26 type-consumer
groups, repository/package lint and clean before/after state. It explicitly is
not a new full root `npm test`. Those results qualify the baseline, not this patch.

Scoped `packages/safe-bash/AGENTS.md`, invocation contracts and the #632/#633
retirement designs were read. The independent brace worker owns current runtime
changes. They are not a #641 candidate and were neither modified nor reverted.

## Implemented decomposition

1. `ExecutionCommandsOptions.maxParallelProcesses` validates/captures the family
   cap during construction. Standard and agent factory/plugin options forward
   `execution`; the existing root export of `commands/index.ts` exposes the type.
   Browser exposes the same type and only registers the execution family when
   `execution` is not undefined. Its local fallback resolves its actual command
   collection, while an available `context.invoke` remains preferred.
2. Keep the existing parser, `-n/-s/-I/-0/-d/-E/-x/-r` behavior, raw fixed-argument
   carrier and default-empty child stdin. Detach each batch before launch.
3. Use one bounded active set and one producer notification slot. Reserve before
   scheduling; release only after child invocation settlement. Pause input at
   capacity, including after a size-driven dispatch. Do not queue all argv,
   collect all results or attach repeated `Promise.race` reactions.
4. Explicitly forward xargs's owned child signal through `context.invoke`.
   Preserve the generic directExecutor/env/find behavior. Custom fallback
   execution receives the signal but is not misrepresented as a Shell budget.
5. Keep the actual inherited sinks, awaited writes and budget metadata; no output
   grouping/serialization buffer or wrapper-induced double charging. Existing
   `Budget.tick`, `Budget.sink` and the root monotonic CPU deadline remain shared.
6. Use a separate input-stop authority to interrupt pending reads without
   cancelling healthy children on numeric terminal results. Track iterator return
   idempotently so the abortable reader's late return remains joined by cleanup.
7. Register cleanup before resource admission. Natural completion drains;
   externally initiated scope cleanup cancels owned work. Failure closes
   admission/cancels children, records a presence-tagged first reason and drains.
   Parent cancellation remains authoritative. Settled child scopes and inline
   snapshots retain existing #632/#633 retirement semantics.

## Outcome contract

| Event | Admission / selection |
| --- | --- |
| Child zero | Continue |
| Ordinary child nonzero | Continue, aggregate 123 |
| First observed child 255 | Stop, retain 124, drain healthy siblings |
| First observed child 126/127 | Stop, retain that status, drain healthy siblings |
| Direct host/input/output throw or rejection | Stop/cancel/drain, then existing xargs mapping |
| Usage error | Stop/cancel/drain any admitted children, diagnostic/status 2 |
| Caller or budget cancellation | Stop/cancel/drain; existing exact-reason precedence |
| Registered child cleanup failure | Shared runtime failure ledger; numeric status cannot hide it |

The `define` wrapper is intentionally unchanged. Ordinary falsey direct failures
still diagnose and return 1; actual Shell-mapped child errors still aggregate to
123. Falsey values are not used as missing-error sentinels. The private input-stop
token only distinguishes xargs's own interrupted reader; it is not used to infer
caller or child cancellation provenance. Direct context and real Shell controls
cover both public boundaries.

Output preserves each child's write ordering, not line/command atomicity or input
order between children. The cap is not a root-wide nested-process limit, and the
bounded active set is not a bound on all runtime metadata or opaque host work.
Existing per-invocation runtime budgets remain necessary. Cooperative input and
child cleanup must eventually finish; no arbitrary-host preemption is claimed.

The new `packages/safe-bash/src/contracts/xargs.md` documents the option, wiring,
scope, output and outcome contract. No README was changed.

## TDD and evidence

All probes use tiny in-memory sources, MemoryFileSystem, explicit child/write/
cleanup gates and a controlled clock. No native oracle, host product subprocess,
disk fixture, copied source tree, generated bulk input or real hang was used.

Sequence retained here rather than erasing failed attempts:

- Initial unchanged-production RED: command cohort 59 tests, 6 pass / 53 fail;
   shell cohort 18 tests, 1 pass / 17 fail. Total 77, 7 pass / 70 fail. The first
   capacity failures show the actual sequential-only diagnostic and zero started
   children. Missing browser registration and absent option validation also fail.
   The baseline output-budget rejection alone is not evidence of working parallel
   execution; the later exact-boundary success control prevents that inference.
- The initial isolated `node --test` invocation reported only two file-level
   failures without leaf diagnostics. Direct test-file execution exposed the RED
   assertions. Subsequent explicit in-process Node test-runner invocations use
   `--experimental-test-isolation=none`; they are focused checks, not a substitute
   for root's maintained runner or a claimed qualification of isolated execution.
- First implementation: 59/59 command controls pass. Shell initially has 15 pass /
   3 fail. Two fixture assumptions expected whole-echo line atomicity, despite
   echo emitting separate chunks; they now use the existing one-write `say`
   capability for the inline-output lifecycle assertion. The other fixture only
   pumped microtasks and starved a legitimate runtime yield; it now allows at
   most 32 event-loop turns, still using explicit resource gates. No runtime fix
   was made for either harness mistake. Corrected cohort: 77/77.
- Added adversarial option/result controls before their fix: 106 total,
   102 pass / 4 fail. Three failures are null cap acceptance; one is a throwing
   child-result accessor that bypassed failure notification. Default only on
   undefined, and catch status-access failures before slot release. Then 106/106.
- Expanded source controls: 115/115, zero skips/cancellations. Final hash-sampled
   rerun: 115/115, duration 440.842767 ms. No source changed during that sampled
   run. This is a local focused result, not a combined product-safety claim.
- Adjacent unchanged cohorts: 122 total, 121 pass / 1 fail, zero skips/cancellations.
   The sole failure is the now-obsolete `execution.test.ts:159` assertion that
   `xargs -P 2` returns 2; actual is correctly 0. That file is outside the leaf's
   exclusive write scope. Root must update that assertion before integration.

The 115 controls cover:

- default/sequential/attached/long/zero/clamped caps and construction-time capture;
- invalid numbers and caps across standard, agent and browser factories;
- exact bounded intake, a held slot across fast completions, and no Promise.race;
- fatal statuses, first-observed order, sibling cancellation only on failures,
  blocked-reader interruption and joined iterator retirement;
- synchronous/asynchronous/falsey host failures and public diagnostics after drain;
- parser failures, quoting, delimiters, replacement, EOF, empty input, size admission,
  raw fixed operands and producer-buffer reuse across split UTF-8;
- default-empty child input, literal dispatch, actual middleware and browser opt-in;
- direct and Shell output backpressure/byte ownership and exact output-budget
  boundaries, including verbose stderr;
- shared command/CPU budgets, root cancellation during budget cleanup, falsey
  cleanup failures, and cleanup failure versus terminal status;
- cleanup-held slots, caller cancellation during held cleanup, repeated parallel
  wave bookkeeping retirement, inline redirects and delayed file completion.

Adjacent literal files executed without filtering assertions:

```text
packages/safe-bash/tests/commands/execution.test.ts
packages/safe-bash/tests/shell/invoke.test.ts
packages/safe-bash/tests/shell/child-dispatch-retirement.test.ts
packages/safe-bash/tests/shell/inline-input-retirement.test.ts
packages/safe-bash/tests/shell/invocation-cleanup.test.ts
```

## Reproduction and identities

Workdir for inspection and focused execution:
`/home/kjopek/kamilio-validation-569-575.RoFXyZ`.
Toolchain pointer `/tmp/kamilio-toolchain.path` selects
`/var/tmp/poe-code-kamilio-toolchain.GzqQj3`, Node v22.22.0. TSX caching is disabled;
TMPDIR is the validation base's existing private `tmp` directory. No persistent
logs or source copies were made; numeric results and source identities are
recorded in this plan and the task transcript.

```sh
TSX_DISABLE_CACHE=1 TMPDIR=/home/kjopek/kamilio-validation-569-575.RoFXyZ/tmp \
  /var/tmp/poe-code-kamilio-toolchain.GzqQj3/bin/node \
  --import /home/kjopek/project/poe-code/node_modules/tsx/dist/loader.mjs \
  --test --experimental-test-isolation=none --test-concurrency=1 --test-reporter=spec \
  /home/kjopek/project/poe-code/packages/safe-bash/tests/commands/xargs-parallel.test.ts \
  /home/kjopek/project/poe-code/packages/safe-bash/tests/shell/xargs-parallel-lifecycle.test.ts
```

Owned source/test SHA-256, unchanged across the final 115-control run:

| Path below packages/safe-bash | SHA-256 |
| --- | --- |
| src/commands/execution.ts | `84e18f0bff74fac9d35c1cf56747e01ecbc2d3692b177552509141ad12d5579d` |
| src/commands/index.ts | `aea0b3c4773f7298f51da7a695efd0a38cdcb1da87058917fad89797e3a4baf8` |
| src/plugins/index.ts | `1a7c9bb2ef602a3f7a344e88de336f1e2ac7c278539ddd268bc27b313b998274` |
| src/browser.ts | `9df1e883c818a8d2489af67044541125cc2a84ef07de60f8275572b682153126` |
| tests/commands/xargs-parallel.test.ts | `cc33bbc09822362ef606d343edad89428492fb04d125b880259967f522a583d5` |
| tests/shell/xargs-parallel-lifecycle.test.ts | `4f873c1d240479e089307ddad579371b97090cbd499135c1aacb8484364275ba` |

Sampled, unowned lifecycle dependencies were also identical before/after that run:

| Path below packages/safe-bash | SHA-256 |
| --- | --- |
| src/shell/runtime.ts | `4e2dbf9d52bebbe2d4de824428281b7a5fd457ccede2f3d8b5c31ee316436134` |
| src/shell/cleanup.ts | `93947948cc802c34dca31f99d1196a0e77869355163157611e41203ac4ac889b` |
| src/shell/arrays/state.ts | `0791f9158e43a55501ae6debaadaf73142e96f54ce1700058c03fe2265c27a1b` |

The initial baseline runtime hash was
`027e65fd7b79c38bea8683afa5102b8542cbf1b525858c4c12c23b843ac3c1d7`.
The differing runtime hash records concurrent brace-worker input, not a leaf
runtime edit or a promoted runtime candidate. These nine-file checks are not a
sealed transitive import closure and do not detect every possible added entry.
Root's eventual frozen combined-source gates remain required.

## Exact write scope and root handoff

Modified production files only:

```text
packages/safe-bash/src/commands/execution.ts
packages/safe-bash/src/commands/index.ts
packages/safe-bash/src/plugins/index.ts
packages/safe-bash/src/browser.ts
```

New files only:

```text
packages/safe-bash/tests/commands/xargs-parallel.test.ts
packages/safe-bash/tests/shell/xargs-parallel-lifecycle.test.ts
packages/safe-bash/src/contracts/xargs.md
docs/plans/bugfix-641-parallel-xargs.md
```

No change to root `src/index.ts` is necessary: its existing star export exposes
the option type via commands/index. No shell/runtime, registry/discovery,
README, Git, build or dist edits were made. No source-tree copy, upstream-merge
retry/workaround, full guard, lint or typecheck ran. A whitespace-only
`git diff --check` of the four owned production files passed.

Root integration steps:

1. Register the two new tests by exact literal path in maintained discovery.
2. Update the obsolete assertion at
   `packages/safe-bash/tests/commands/execution.test.ts:159` to expect success for
   `-P 2`, preserving all adjacent assertions. No default command inventory
   change is needed for browser; opt-in adds only the execution family.
3. Freeze the combined independent-worker source inputs. Rerun the 115 controls
   and all five adjacent files, then the maintained selected build/unit/type/lint
   routes assigned to root. The option type imports are exercised syntactically
   here, but strict/public consumer type qualification remains root-owned.
4. Preserve the documented output interleaving, existing diagnostic mapping,
   per-invocation cap and cooperative-cleanup limits when reviewing.

No concrete shell-core invariant failure remains in the owned focused controls;
no cross-scope production change is requested. Local leaf implementation,
combined qualification, remote-main delivery and release are separate states.

## Root-authorized assertion update and normal-isolation verification

September 5, 2026: root extended the leaf's write scope to exactly the existing
case at `packages/safe-bash/tests/commands/execution.test.ts:152` and this evidence
appendix. Root reports both new test paths are already registered. No registration
or production file was edited in this follow-up.

The former `-P 2` rejection assertion now checks the supported empty-input result:
exit status 0, exactly one stdout newline, and empty stderr. An explicit `-P -1`
status-2 rejection assertion remains alongside it. All other assertions in the
case and file are unchanged. The source diff is five added lines and one removed
line. The earlier 121/122 adjacent result and initial isolated-run failure remain
recorded above; this appendix supersedes the outstanding assertion-update step,
not its historical evidence.

The first escalation request timed out in automatic permission review and did
not execute. Its single permitted retry succeeded. The exact seven-file cohort
then ran outside the sandbox with normal node:test child-process isolation:
**237 tests, 237 pass, zero failures, cancellations, skips or todos; exit 0;
1793.005173 ms.** This includes all 115 new controls and all 122 adjacent tests,
without name filters or omitted assertions. No in-process isolation override,
forced exit, timeout expansion or production workaround was used.

Executed from `/home/kjopek/kamilio-validation-569-575.RoFXyZ` with
`sandbox_permissions: require_escalated`:

```sh
TSX_DISABLE_CACHE=1 TMPDIR=/home/kjopek/kamilio-validation-569-575.RoFXyZ/tmp \
  /var/tmp/poe-code-kamilio-toolchain.GzqQj3/bin/node \
  --import /home/kjopek/project/poe-code/node_modules/tsx/dist/loader.mjs \
  --test --test-concurrency=1 --test-reporter=spec \
  /home/kjopek/project/poe-code/packages/safe-bash/tests/commands/xargs-parallel.test.ts \
  /home/kjopek/project/poe-code/packages/safe-bash/tests/shell/xargs-parallel-lifecycle.test.ts \
  /home/kjopek/project/poe-code/packages/safe-bash/tests/commands/execution.test.ts \
  /home/kjopek/project/poe-code/packages/safe-bash/tests/shell/invoke.test.ts \
  /home/kjopek/project/poe-code/packages/safe-bash/tests/shell/child-dispatch-retirement.test.ts \
  /home/kjopek/project/poe-code/packages/safe-bash/tests/shell/inline-input-retirement.test.ts \
  /home/kjopek/project/poe-code/packages/safe-bash/tests/shell/invocation-cleanup.test.ts
```

The updated `tests/commands/execution.test.ts` SHA-256 is
`a934df83fad2d17cd30abdcfe36ac6d82faa4a69f19fa4b4b5ad2167952adb25`.
The four owned production files and two new tests retain every SHA-256 in the
earlier owned-source table. Those seven files and the following three unowned
brace-worker inputs were sampled before and after this run; all ten samples were
unchanged across the observation interval:

| Path below packages/safe-bash | SHA-256 |
| --- | --- |
| src/shell/runtime.ts | `bd3e8973a0ffa7215de1cc79774065a504f4793e6732443edaf211c9d568e145` |
| src/shell/parser.ts | `7a1386ec0371ace8d41292f2838fc22d78c0492ba9b059d86963c6941978a2a5` |
| src/shell/brace-expansion.ts | `10b1eb2a5bf31b0f3df08ba0a44db7b03b319775726618de86fc54b65fff1d5c` |

This sampled stability is not a frozen transitive closure or full gate. The brace
worker remains active, and its runtime/parser changes are not #641 production
edits. Root still owns combined freezing, maintained build/type/lint/unit gates,
Git delivery and release. The leaf handoff is complete with this focused
normal-isolation verification; no further production change is requested.

## Root integration review

Root independently ran the seven-file xargs cohort together with both brace
suites under normal node:test process isolation: 312/312 passed. The maintained
integration-input registry also passed 98/98. Evidence is retained in
`/home/kjopek/kamilio-validation-569-575.RoFXyZ/tmp/issues-637-641-root-focused.log`
and `issues-637-641-registry.log` in the same directory. Root reviewed the bounded
admission, sticky terminal statuses, input retirement, shared invocation budgets,
public factory wiring and cleanup-before-acquisition paths. These focused checks
do not establish the pending full combined gate, remote delivery or release.
