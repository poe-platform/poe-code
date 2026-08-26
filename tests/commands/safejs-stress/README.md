# Independent SafeJS command stress handoff

August 26, 2026; Node v22.22.2. Independent of source author Plato. Ownership
was restricted to command SafeJS source/tests and this directory. No delegation,
commits, dependency installation, private-engine writes, host evaluation, signal
omission, or production API changes. All virtual filesystems used by these
tests are memory-backed. No plugin implementation defect was found in this
bounded pass; **no production TypeScript was changed**.

## Historical stress-writer results

The following results and original final-run labels belong to the stress
writer's August 26, 2026 snapshot, reported in
`/tmp/safe-bash-safejs-stress-fix-result.txt`. The later independent review below
refreshes the main counts against a changed engine snapshot; it does not erase
the author history or failures.

| Run | Total | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Initial author command scope, local engine enabled | 64 | 64 | 0 | 0 |
| Initial author command scope, no local-engine env | 64 | 39 | 0 | 25 |
| Final author command + existing bridge suites, local engine | 92 | 92 | 0 | 0 |
| New independent conventional tests, local engine | 51 | 51 | 0 | 0 |
| Full owned conventional scopes, local engine | 115 | 115 | 0 | 0 |
| Full owned conventional scopes, no local-engine env | 115 | 59 | 0 | 56 |
| Five strict lifecycle/local/independent repeats, each | 107 | 107 | 0 | 0 |
| Separate unresolved desired-semantics probe, local engine | 9 | 0 | 9 | 0 |
| Final inclusive owned scopes, including desired probe, local engine | 124 | 115 | 9 | 0 |
| Final inclusive owned scopes, including desired probe, no env | 124 | 59 | 0 | 65 |

The 115 conventional checks comprise **59 always-runnable fixture/configuration
checks**, **45 actual-engine behavior checks**, **10 explicit known-defect
characterizations** using the actual engine, and **1 real structural TypeScript
compatibility probe** (no guest run). Thus 55 conventional tests execute the
actual engine, not 115. This counts tests, not individual `run()` calls, which
some tests make multiple times. The 51 new tests comprise 20 fixtures, 22 actual
behavior checks and 9 known-defect characterizations. Fixture runners do not
interpret source and are not sandbox-security evidence.

The nine desired-semantic probes remain **0/9 accepted**. Including those probes,
the observed assertion count is 124 = 115 passed + 9 failed, not a clean
compatibility gate. Five repetitions are 535 check executions, not 535 distinct
tests or successful language behaviors. Reviewer scratch suites are not added
to this worker's denominators.

## Exact commands

```sh
env -u SAFEJS_LOCAL_ROOT node --unhandled-rejections=strict --import tsx --test \
  tests/commands/safejs/*.test.ts

SAFEJS_LOCAL_ROOT=/Users/kjopek/Workspace/poe-code/packages/safejs \
node --unhandled-rejections=strict --import tsx --test \
  tests/commands/safejs/*.test.ts

SAFEJS_LOCAL_ROOT=/Users/kjopek/Workspace/poe-code/packages/safejs \
node --unhandled-rejections=strict --import tsx --test \
  tests/commands/safejs/*.test.ts tests/integrations/safejs/*.test.ts

SAFEJS_LOCAL_ROOT=/Users/kjopek/Workspace/poe-code/packages/safejs \
node --unhandled-rejections=strict --import tsx --test \
  tests/commands/safejs/*.test.ts tests/commands/safejs-stress/*.test.ts

env -u SAFEJS_LOCAL_ROOT node --unhandled-rejections=strict --import tsx --test \
  tests/commands/safejs/*.test.ts tests/commands/safejs-stress/*.test.ts

for iteration in 1 2 3 4 5; do
  SAFEJS_LOCAL_ROOT=/Users/kjopek/Workspace/poe-code/packages/safejs \
  node --unhandled-rejections=strict --import tsx --test \
    tests/commands/safejs/lifecycle.test.ts \
    tests/commands/safejs/local-safejs.test.ts \
    tests/commands/safejs-stress/*.test.ts
done

SAFEJS_LOCAL_ROOT=/Users/kjopek/Workspace/poe-code/packages/safejs \
node --unhandled-rejections=strict --import tsx --test \
  tests/commands/safejs-stress/upstream-desired.probe.ts
```

The last command exits 1 with nine failures by design on the unfixed engine;
it is separately named so the conventional suite can characterize the known
state without claiming desired semantics. Run and report both. If the engine
is unavailable, optional tests skip explicitly; never install a private package
or substitute a fake interpreter to turn these into passes.

The final inclusive runs explicitly include the unresolved probe as well:

```sh
SAFEJS_LOCAL_ROOT=/Users/kjopek/Workspace/poe-code/packages/safejs \
node --unhandled-rejections=strict --import tsx --test \
  tests/commands/safejs/*.test.ts tests/commands/safejs-stress/*.test.ts \
  tests/commands/safejs-stress/upstream-desired.probe.ts

env -u SAFEJS_LOCAL_ROOT node --unhandled-rejections=strict --import tsx --test \
  tests/commands/safejs/*.test.ts tests/commands/safejs-stress/*.test.ts \
  tests/commands/safejs-stress/upstream-desired.probe.ts
```

These exit 1 (115 passed, 9 upstream failures) and 0 (59 passed, 65 skipped),
respectively. Including the desired probes, 64 tests execute the actual engine:
55 conventional real-engine checks plus 9 failing desired-behavior checks.

Scoped strict TypeScript, whole-project TypeScript and production build all
exited 0 at the final check. No unowned type/build errors were observed in this
run; this does not rewrite earlier concurrent-error reports. Exact commands:

```sh
node_modules/.bin/tsc --noEmit --target ES2023 --lib ES2023 \
  --module NodeNext --moduleResolution NodeNext --strict \
  --noUncheckedIndexedAccess --exactOptionalPropertyTypes \
  --verbatimModuleSyntax --forceConsistentCasingInFileNames \
  --skipLibCheck --types node \
  src/commands/safejs/*.ts tests/commands/safejs/*.ts \
  tests/commands/safejs-stress/*.ts
npm run typecheck
npm run build
git diff --check -- src/commands/safejs tests/commands/safejs tests/commands/safejs-stress
```

## Coverage and limitations

- Inline/file/stdin sources, dash-leading files, literal hostile argv, exact
  source byte/BOM boundaries, virtual cwd/env and shared byte/file effects.
- Partial UTF-8 and fragmented binary streams, serialized byte cursors, combined
  stdout/stderr/return quotas, downstream backpressure and Shell early-close.
- Pending source/guest/runner/sink work, iterator cleanup, late rejections,
  cancellation propagation into the actual engine and memory VFS, preserved
  prior effects, and stale-capability rejection after completion.
- Exact forwarded interpreter limits, fresh budgets, real step/call-depth/
  string/array/data-size/deadline enforcement, and an action-producing loop
  stopped by the step budget. There is no separate plugin `maxActions` option;
  this does not invent one or extend capabilities to the external action bridge.
- Non-replayable policies for all six stdio operations and `setExitCode`, fresh
  modules across concurrent invocations, and no snapshot/resume provider passed.
  These checks do not add or prove resumable shell-command execution.
- Guest capability denial and source/data separation are finite probes, not an
  exhaustive engine security proof. Source helpers cannot forcibly interrupt
  arbitrary synchronous host work or undo uncooperative late side effects.

The first independent real-engine run was **39 passed / 2 failed out of 41**,
preserved in `/tmp/safe-bash-safejs-stress-first-real.tap`. The failures were
own-`__proto__` data loss and a data-size workload blocked before budgeting by
lost `Array.from` static support. Direct no-signal/live-signal comparisons
isolated both upstream. The budget test now uses supported loop syntax; static
support and own-key preservation remain explicit failed desired probes rather
than silently reduced acceptance requirements.

See `UPSTREAM_PATCH_PROPOSAL.md` for raw repros and an **untested, unapplied**
proposal. Actual supplied-signal `new Error`, `new TypeError`, `new Map`,
`new Set`, `new RegExp`, `Array.isArray`, `Array.from`, own `__proto__` data,
and raw pre-aborted pure runs remain incompatible with their expected behavior.
The plugin retains its signal and correctly prechecks parent cancellation.

### Additional promise-observation limitation

The read-only reviewer verified a separate actual-engine observation: a host
callback aborts the live signal and supplies a rejected promise. The engine
surfaces the abort, then the unobserved host rejection terminates strict Node.
Expected lifecycle behavior preserves the abort reason and observes the
already-created promise's rejection, with no separate unhandled rejection.
The high-level, unapplied proposal in `UPSTREAM_PATCH_PROPOSAL.md` covers both
upstream promise wrappers' early-abort paths, preserving cancellation and
listener cleanup without global rejection suppression.

External evidence: `/tmp/safe-bash-safejs-abort-in-action.mjs`,
`/tmp/safe-bash-safejs-abort-in-action.log`, and the final-snapshot log
`/tmp/safe-bash-safejs-final-action-abort.log`. **No durable executable regression
exists for this newly reported observation**. The desired probe count remains
nine; this separate observation is not included in those nine or any passing
count. The action module is not installed by default by the plugin; no plugin
implementation or adapter bug was confirmed. Plugin runtime is unchanged.

## Historical source hashes

Actual private package version: `@poe-code/safejs` 0.0.1. Private checkout HEAD
observed after validation: `201bb209996aaf7af0291a022dbe644e6069cb3a`. This is
not a claim the private working tree is clean, nor the historical author HEAD.

At the stress writer's snapshot, all five production command `.ts` hashes and
all five inspected engine files matched that worker's initial checkpoint:

| Source | SHA256 |
| --- | --- |
| command `index.ts` | `479c111291e2e181b3ab1a8a41905592ff71b968a691e25f21970eee089d8f29` |
| command `io.ts` | `ef366f40b1d1d161ec0f2c18f1138daf75693ab416274bb92763ebf73899f2f1` |
| command `options.ts` | `4009050c3a75daececeb2e75af46be8872d21a83c7a8132b6221b0b4d87c7a43` |
| command `render.ts` | `10eabbdc8d3c1f2e7c40aeafd51b15484ece05de844fcb73f2ef1aed01fe5d6e` |
| command `types.ts` | `edd5f7cf2ed473ca33105cfe1039c3fb36ae913112d0564ea3d9b163b3c08bf4` |
| engine `src/run.ts` | `0ad27b6b50ceabc2e92c64a8950e9e8faa1a477745be400ad0fcbb2534683f5f` |
| engine `src/interp/budget.ts` | `861f58d5db16232ec9cacaf77e25f20842376a510ecc6582f12d8488daecf639` |
| engine `src/interp/host-bridge.ts` | `5839aa1b00e0116f73f107c5cc5e85010cc94d304a241bb18ee90be701b1f8de` |
| engine `src/interp/cancel.ts` | `7652feb38be7c034e7f98f8e98370835307571fec46647d930908a3c1a23d6e4` |
| engine `src/modules/fs.ts` | `99fc3a501ce906aa2021f298ef8803b63d2272de5f412dfcdf3714757510b142` |

The stress writer's historical 229-file engine source-tree SHA256 was
`2be4c53ad67cd84f598773aa867d82b4e1afa58d7ed8e0acc85bb3db592dcc5d`, matching the
separate reviewer's earlier checkpoint. Algorithm: lexically sorted paths
relative to the SafeJS package root, each `path + NUL + bytes + NUL`. Using paths
relative to `src` instead yields
`a260b11010266c7f4c6074438098496196a96c0031f331bfc196660ebd745630`; these are two
path conventions, not a source-content change. The same algorithm over the
five plugin `.ts` files, paths relative to `src/commands/safejs`, yields
`be599af3506daeb8f949dfc200dc0fa9d18d48f7805b3e849d66b7f435ab05d2`.

## Later independent read-only review

The current checkpoint `/tmp/safe-bash-safejs-upstream-checkpoint.txt` links
`/tmp/safe-bash-safejs-independent-final-review.txt` (August 26, 2026). The
anticipated `/tmp/safe-bash-safejs-upstream-review.txt` was not available at
this documentation handoff. The available final report refreshed conventional
**115 passed**, inclusive **115 passed/9 failed**, and no-env inclusive
**59 passed/65 skipped**. Its separate 15 checks passed; its overlapping scratch
desired suite remained 0 passed/7 failed. Five full-plus-reviewer repetitions
passed 130/130 each, not 650 distinct behaviors. These extras do not enlarge
the owned nine-probe denominator or turn characterizations into acceptance.

The report records external private-engine changes before its final gate,
including `run.ts`, `budget.ts`, and `host-bridge.ts`. Its 238-file final engine
snapshot SHA256 was
`36673b386793b61fca9b65990320a0c57b584d34b833aff85869be79fd810e63`, using the
package-relative algorithm above. Stability was verified across that final
gate only; the earlier 229-file hashes remain historical, not current-source
claims. The report contains changed per-file hashes and final evidence paths.
The actual engine was read-only to the reviewer, and plugin implementation
remained byte-identical to author baseline `ea0867f`.

This handoff changes explanatory documentation only: no engine/crash execution,
new executable fixtures, source/test changes, or private-worktree writes. The
review's source/test/docs snapshot predates these prose edits; its hash does not
describe the updated documentation. Root retains final documentation review.

## Evidence locations

### Current v3 proposal (August 26, 2026)

Only the candidate's static AbortError message is corrected to the established
native/upstream spelling. The new 18-case reason fixture now uses an independent
default native AbortSignal message; original nine/upstream tests stay unchanged.
Targeted tests pass **109/109**; full pinned suite passes **3225/0/38**
(pass/fail/skip, 3263 tests/125 files); reason safety **18/18**. Original ten stays
**9/10**, invariant gate **8/9**, and verifier still demands 10/10 and exits 1.
Stable source checkpoint: `/tmp/safe-bash-safejs-v3-source-stable.txt`.
Evidence: `docs/upstream-patches/safejs/EVIDENCE.md`. Separate review pending;
no rawidentity or quota redesign, no private edits or commit.

### Historical v2 proposal (August 26, 2026)

The cause-preserving run.ts proposal and durable `reason-contract.probe.mjs`
retain the investigator's 18 safety assertions after source/fixture inspection.
V2 passes 18/18 and the unchanged shape audit 12/12, but original nine plus
action-abort remains **9/10** because raw Error identity is not cause identity.
Two full-suite message-spelling mismatches remain (**3223 pass / 2 fail / 38
skip**, 3263 tests/125 files on the pinned baseline). Invariants remain **8/9**
with conservative quota inflation. No tests were relaxed; verifier still expects
10/10 and exits 1. Current private source drift is recorded and rejected by the
baseline guard; explicit fresh copies of the preserved pinned baseline are used.
See `docs/upstream-patches/safejs/EVIDENCE.md` for distinct v1/v2 evidence. Status:
**NOT APPROVED**, pending upstream contract decision and separate final review.

### Historical v1 isolated candidate (August 26, 2026)

`docs/upstream-patches/safejs/README.md` documents the new guarded, temporary-copy
patch reproducer. This later assignment adds durable action-abort, wrapper and
promise lifecycle, import-provenance, and artifact-guard probes in this directory.
It does not modify the shipped plugin or private engine. The unchanged original
nine plus durable action-abort pass 10/10 on the candidate, compared with 0/10 on
baseline; the full unchanged upstream suite still fails one error-shape audit and
a conservative shared-capture budget diagnostic remains unresolved. Candidate
status: **NOT APPROVED**. Earlier prose-only/no-execution statements in this file
belong to their historical documentation handoff, not the new implementation.

### Historical logs

Checkpoint: `/tmp/safe-bash-safejs-stress-checkpoint.txt`.
TAP logs under `/tmp/safe-bash-safejs-stress-`: `baseline-real.tap`,
`baseline-without.tap`, `command-bridge.tap`, `final-real.tap`,
`final-without.tap`, `repeat-1.tap` through `repeat-5.tap`, `desired.tap`.
Final inclusive runs: `inclusive-real.tap` and `inclusive-without.tap`.
Type/build logs: `scoped-typecheck.log`, `global-typecheck.log`, `build.log`.
Hashes: `final-hashes.txt` (its engine tree line uses the `src`-relative variant).

No commits or staging performed. This handoff does not assert full Shell/Bash
support, adapter parity, exhaustive security, superiority, or 72 hours worked.
