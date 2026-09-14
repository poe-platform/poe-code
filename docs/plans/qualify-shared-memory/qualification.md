# qualify-shared-memory qualification

Status: **incomplete**. The two restored-wait repairs below are bounded improvements,
not a claim of deterministic recovery for arbitrary shared-memory histories.

## Source, environment, and target

Started on local `main`, `e044be891151cf6f4b3ff20eaaf8838b687e3869`, with
pre-existing local and staged changes. `initial-source.json` records individual
SafeJS TypeScript hashes and the initial index digest. Remote main observed and
fetched during this audit: `da2ff844e7e72e96fc74e059e896822b0e920a86`.
The two runtime files governing atomic registration/restoration have no difference
between these committed revisions; other SafeJS surfaces differ. This is a dirty
local-source qualification, not a clean remote-main qualification.

Node `22.23.2`, V8 `12.4.254.21-node.56`, ICU `78.2`, CLDR `48.0`, Unicode `17.0`,
darwin/arm64. The run starts September 13 local / September 14 UTC, 2026.
Only this runtime was executed. Required Node18/20/24/26, Bun, and Workerd cells
are **unverified**, not skipped passes. Growable shared storage requires host
support, and the existing explicit unsupported-backend rejection is preserved.

The target remains ECMA-262 **edition 16, June 2025**, ECMA-402 edition 12,
and the previously recorded, separately pinned extensions. Atomics.pause keeps
its separate baseline pin. Neither immutable ArrayBuffer fixtures in newer
Test262 nor later draft changes silently expand the published-edition target.

Primary sources:

- [ECMA-262 edition 16](https://262.ecma-international.org/16.0/), clauses
  SharedArrayBuffer, Atomics, DoWait, Atomics.notify and the memory model.
  `specification.json` retains the downloaded edition hash and extracted clauses.
- [Test262 host-agent contract](https://github.com/tc39/test262/blob/419d3e0a2273ba01a3bfcbec423f2801425b8e93/INTERPRETING.md).
  Clean corpus checkout: `/tmp/qualify-shared-memory-test262`, revision
  `419d3e0a2273ba01a3bfcbec423f2801425b8e93`.
- The SafeJS recovery contract is a product contract, not an ECMAScript feature:
  public `src/restore.ts` validates replay envelopes; `src/snapshot/restore.ts`
  reconstructs low-level state and exposes explicit wait activation.

The edition's extracted DoWait step 13 says `i × 4`, including the BigInt64 path.
This is an edition/upstream reconciliation lead; native eight-byte indexing is
not by itself authority to rewrite the pinned text or claim full edition coverage.

## Cases and owners

All cases below have primary owner **qualify-shared-memory**. Runner admission
also touches the maintained conformance integration surface. These case IDs do
not close unrelated category-owner rows in the baseline inventory.

| Case | Category and contract | Counterexample/control | Disposition |
| --- | --- | --- | --- |
| SM-OWN-1 | Product recovery/cleanup contract | Low-level restored pending wait activated outside `runResources`; same snapshot activated inside an owner | Reproduced and repaired: missing owner rejects before registering; rejected unowned attempt does not consume the owned activation opportunity |
| SM-OWN-2 | Product lifecycle contract | Reuse activated snapshot from a different owner after initial owner disposal; same-owner repeated activation | Reproduced and repaired: foreign owner rejects; same-owner calls retain the same activation promise |
| SM-RACE-1 | Product recovery; ECMA-262 DoWait distinguishes comparison failure from an already queued wait | Controlled mutation after restore reads current value but before worker registration; original already-queued waiter remains notifiable after value changes | Reproduced and repaired: reject concurrent mutation instead of settling reconstructed pending wait as `not-equal` |
| SM-RUNNER-1 | Missing conformance evidence, not a missing runtime global | Tagged integer/BigInt SAB fixture excluded before evaluation; ordinary fixture control | Admission repaired for non-agent shared-memory fixtures; native-host nonblocking mode checked independently |
| SM-AGENT-1 | Missing harness capability/evidence | Pinned `false-for-timeout-agent.js` needs start/broadcast/report and isolated agents; neighboring `false-for-timeout.js` needs no agent | **Open**: `$262.agent`, `atomicsHelper.js` and CanBlockIsTrue remain explicit nonpasses. Existing child-process variant isolation is not an implementation of child agents |
| SM-REPLAY-1 | Product recovery defect; unrecorded host-retained shared writes | Queued microtask write after host callback returns gives original 7, pending replay 0, completed replay 0; synchronous write gives 7 in all paths | **Open acceptance blocker**: unsupported history is currently accepted without early rejection |
| SM-REPLAY-2 | Fundamental capture limit/host authority | Independent writer can change then restore bytes between snapshots, or race a byte-copy snapshot | **Excluded from deterministic guarantees**, but blanket early rejection is not implemented; cannot claim acceptance |
| SM-WAIT-1 | Product continuation contract plus DoWait/notify | Existing FIFO, byte-location, remaining-time, cancellation, failed-registration cleanup tests | Revalidated by focused checks; detached private reconstructed queues only, not preservation of an external agent cluster |
| SM-BUFFER-1 | SharedArrayBuffer/grow/view contracts | Fixed/growing aliases, independent blocks, host-retained cross-call aliases, invocation/settlement writes and growth | Existing focused tests revalidated; no new buffer runtime defect inferred from historical reports |

`atomic-wait-race.test.ts` controls worker registration independently of the
interpreter, delegates comparison/wait results to real native Atomics, and uses
no timing race or canned successful wait. `atomic-wait.test.ts` independently
controls acknowledgement and settlement for public pending replay. Native results
are controls; the reason for rejecting a reconstructed `not-equal` is that the
original wait was already queued, as distinguished by DoWait steps 20 and 28.

Activation now requires a live resource owner only when the snapshot contains
pending atomic waits. It binds to that owner, rejects a different owner, and
preserves existing same-owner idempotence. Owners still control cleanup; activation
does not grant blocking authority or cancel unrelated native waiters. Failed
activation remains associated with its owner; callers must dispose that scope.
This does not establish support for externally mutated restored queues or for
transferring registrations among owners.

Low-level/public distinction was independently observed in `restore-contract.log`:
a raw low-level serialization is rejected by public restore at `$.version`, while
low-level restore accepts it paused (zero registrations before activation). That
is an envelope distinction, not a proof that every malformed replay is rejected.

## Reproductions and TDD

Commands run from `/Users/kjopek/Workspace/poe-code`. No budgets, assertions,
timeouts, minimum runtime, or guest blocking authority were relaxed.

1. `npx vitest run packages/safe-js/src/interp/atomic-wait.test.ts packages/safe-js/src/interp/shared- packages/safe-js/src/interp/globals/atomics- packages/safe-js/src/interp/globals/shared-array-buffer.test.ts packages/safe-js/src/snapshot/atomic-wait-continuation.test.ts packages/safe-js/src/snapshot/shared-array-buffer.test.ts`
   Initial baseline: **233 passed / 17 files**, 8.20 s, `baseline.log`.
2. `npx vitest run packages/safe-js/src/snapshot/atomic-wait-ownership.test.ts`
   Before runtime repair: **2 failed**, 1.89 s; both expected rejections resolved
   `undefined` (`ownership-red.log`). Revision: initial HEAD with preserved dirty
   source, before the task's restore change.
3. `npx vitest run packages/safe-js/src/snapshot/atomic-wait-ownership.test.ts packages/safe-js/src/snapshot/atomic-wait-continuation.test.ts packages/safe-js/src/interp/atomic-wait.test.ts`
   After ownership repair: **27 passed**, 2.74 s (`ownership-green.log`).
4. `npx vitest run packages/safe-js/test/conformance/shared-memory.test.ts`
   Before runner repair: **2 failed / 1 passed**, 2.14 s (`runner-red.log`).
   Expected shared execution and nonblocking TypeError qualification instead
   returned unsupported. The blocking-agent exclusion control already passed.
5. `npx vitest run packages/safe-js/test/conformance/shared-memory.test.ts packages/safe-js/test/conformance/execute.test.ts packages/safe-js/test/conformance/worker.test.ts`
   After admission repair: **49 passed**, 2.87 s (`runner-green.log`). Existing
   exclusion assertions were narrowed to requirements that remain excluded;
   actual semantics and a blocking-boundary control replace shared exclusion.
6. `npx vitest run packages/safe-js/src/snapshot/atomic-wait-race.test.ts`
   Before race repair: **1 failed**, 1.87 s (`race-red.log`); expected rejection
   instead resolved `undefined`. This is after the ownership repair and before
   the race guard.
7. `npx vitest run packages/safe-js/src/snapshot/atomic-wait-race.test.ts packages/safe-js/src/snapshot/atomic-wait-ownership.test.ts packages/safe-js/src/snapshot/atomic-wait-continuation.test.ts`
   After race repair: **19 passed**, 2.35 s (`race-green.log`).
8. `npx eslint packages/safe-js/src/snapshot/restore.ts packages/safe-js/src/snapshot/atomic-wait-ownership.test.ts packages/safe-js/src/snapshot/atomic-wait-race.test.ts packages/safe-js/test/conformance/execute.ts packages/safe-js/test/conformance/execute.test.ts packages/safe-js/test/conformance/shared-memory.test.ts`
   Exit 0 (`lint.log`).
9. `npx tsc --noEmit -p packages/safe-js/tsconfig.json`
   Exit 0 (`typecheck.log`).

Broader qualification and upstream terminal results are recorded below.
Focused tests are not represented as the full maintained package gate.
No visual CLI behavior changed; no screenshot check is applicable.

## Smallest unrecorded-write counterexample

Run as ESM (`node --import tsx --input-type=module`), not `tsx -e`'s CJS path:

```js
import {run} from './packages/safe-js/src/run.ts';
import {dump} from './packages/safe-js/src/dump.ts';
const source = 'const a=new Uint8Array(new SharedArrayBuffer(4));save(a.buffer);await Promise.resolve();return a[0]';
let calls = 0;
const bindings = {save: b => {
  calls++;
  queueMicrotask(() => { new Uint8Array(b)[0] = 7; });
}};
const original = await run(source, {bindings});
const replay = await run(source, {bindings, snapshot: JSON.parse(await dump(original))});
console.log({original: original.returnValue, replay: replay.returnValue, calls});
```

Expected: reproduce the captured observation, or explicitly refuse an unsupported
history before resuming. Actual: `{original:7,replay:0,calls:1}`.
`out-of-band-reproduction-v2.log` records this on the task candidate. No timer,
racing wall deadline, external input, or native-engine semantic oracle is involved.
`recovery-matrix.log` adds a host gate after recording the read, dumps it pending,
then completes and dumps again. Both replays give 0 for the queued write; both give
7 when the write runs inside the original synchronous host callback.

Snapshot boundary bytes and final storage do not uniquely identify intervening
reads/writes. Reissuing a callback, retrying wait comparisons, or copying the final
bytes into the initial state cannot reconstruct that history. Rejecting every
host-exposed buffer would also remove existing supported transactional/alias paths.
No such blanket removal or invented replay was introduced. A complete repair must
establish an explicit capture/ownership protocol covering external mutation, or
reject that class before replay and effects. **The current code does neither for
this counterexample.**

## Failures and unavailable checks retained

- First upstream invocation incorrectly passed `test/built-ins/...`; runner joins
  paths below `test`, so it rejected `/test/test` with ENOENT. `upstream.jsonl`
  is an aborted record, not a semantic result.
- Second invocation used correct paths, but this task edited runtime sources
  during enumeration. The maintained source-drift guard rejected the run;
  `upstream-v2.jsonl` is an aborted record, not a pass. Third invocation starts
  after runtime/test edits are frozen.
- First direct counterexample used `tsx -e`; its CJS import path could not load
  a generated Intl dependency. `out-of-band-reproduction.log` retains that setup
  failure; the ESM rerun executes successfully and exposes the semantic defect.
- Web extraction rejected the full edition as too large; curl retrieved it.
  Python BeautifulSoup was unavailable; stdlib HTMLParser extracted clauses
  without changing project dependencies.

## Delivery

Two local implementation commits are recorded below. Verified remote-main
delivery of these changes: **none**. Task release/publication receipt: **none**.
No push occurred, and no previous publication is attributed to this candidate.
Unrelated local and staged changes are preserved. Acceptance remains open for
agent execution/upstream agent coverage, general early recovery rejection,
required runtime cells, and release.

## Terminal qualification results

Broader command:

```sh
npx vitest run packages/safe-js/src/snapshot packages/safe-js/src/interp/atomic-wait.test.ts packages/safe-js/src/interp/shared- packages/safe-js/src/interp/globals/atomics- packages/safe-js/src/interp/globals/shared-array-buffer.test.ts packages/safe-js/src/run.completed-replay.test.ts packages/safe-js/test/conformance
```

**2,801 passed / 206 files**, zero failures/skips, exit 0, 135.63 s.
`qualification.log` retains individual files and timing. This selection covers the
entire snapshot directory and maintained conformance tests, not the whole package.

Pinned upstream command:

```sh
npm run test:conformance --workspace=@poe-code/safe-js -- --corpus /tmp/qualify-shared-memory-test262 --include built-ins/SharedArrayBuffer --include built-ins/Atomics --timeout-ms 3000 --report /Users/kjopek/Workspace/poe-code/docs/plans/qualify-shared-memory/upstream-v3.jsonl
```

Terminal result: **493 files / 986 variants = 730 passed + 18 failed + 238
unsupported**, no metadata/execution errors; complete=true, exit **1**. Execution
04:13:51.864–04:17:07.185 UTC on 2026-09-14. Source SHA
`e044be891151cf6f4b3ff20eaaf8838b687e3869`, dirty runner/runtime source hash
`5215cd4557d06e921fa44ebc24b4e6c9064228a4577efcaff31243f4725c44e5`.
The maintained runner's independent child-process hard wall stays 3,000 ms,
with its existing 10,000 ms startup allowance. Default static budgets remain
unchanged (unlimited in this maintained command). No variant was retried.

`upstream-disposition.json` lists every nonpass and original detail. All 18 failed
variants are the sloppy/strict forms of nine immutable-buffer fixtures (add,
and, compareExchange, exchange, notify, or, store, sub, xor). Their pinned metadata
requires `immutable-arraybuffer`; the upstream typed-array helper reports that it
has no immutable argument factory. This is a newer-API availability/edition-mapping
case, shared with **qualify-binary-memory**, not evidence of an ECMAScript-2025
Atomics defect. These are still failed results, not rewritten as passes. The 238
unsupported variants consist of **224 agent** and **14 blocking-mode** variants;
none establish agent coverage. This expressly fails that part of task acceptance.

The small ordinary waitAsync fixture and its agent counterpart remain separately
identifiable in the report; executing the former does not qualify the latter.
`INTERPRETING.md` and all loaded upstream harness hashes are recorded. No fixture
source was rewritten.

## Reproduce pending and completed unrecorded-write histories

Run the following using `node --import tsx --input-type=module` from the root:

```js
import {run} from './packages/safe-js/src/run.ts';
import {dump} from './packages/safe-js/src/dump.ts';
import {declareHostOperation} from './packages/safe-js/src/interp/host-bridge.ts';
for (const outOfBand of [false, true]) {
  const source = 'const a=new Uint8Array(new SharedArrayBuffer(4));save(a.buffer);await Promise.resolve();const observed=a[0];await hold();return observed';
  let entered, release;
  const ready = new Promise(r => entered = r);
  const gate = new Promise(r => release = r);
  let saves = 0;
  const bindings = {
    save: b => {
      saves++;
      const write = () => { new Uint8Array(b)[0] = 7; };
      if (outOfBand) queueMicrotask(write); else write();
    },
    hold: declareHostOperation(async () => { entered(); await gate; }, 're-issue')
  };
  const pending = run(source, {bindings});
  await ready;
  const saved = JSON.parse(await dump(pending, {mode: 'replay'}));
  release();
  const original = await pending;
  const completed = JSON.parse(await dump(original));
  const replayBindings = {...bindings, hold: declareHostOperation(async () => {}, 're-issue')};
  const replayPending = await run(source, {bindings: replayBindings, snapshot: saved});
  const replayCompleted = await run(source, {bindings: replayBindings, snapshot: completed});
  console.log({outOfBand, original: original.returnValue,
    pendingReplay: replayPending.returnValue,
    completedReplay: replayCompleted.returnValue, saves,
    explicitRecoveryError: saved.replayError ?? null});
}
```

The control produces `7/7/7`; the counterexample produces `7/0/0`. Both invoke
`save` only once. No explicit recovery error is present. This is a deterministic
reproducer, not a passing regression assertion or a solved limitation.

## Local commit receipts and preservation

- `8089068f678e97a3e3e7a738b28745b6a4dc6772` —
  `fix(safe-js): reject unsafe atomic wait activation`.
- `e0b76883387d9e38826f014d3e3e24202d25e65b` —
  `fix(safe-js): admit non-agent shared memory conformance`.

Both are local commits on main. The runner commit stages only this task's
admission changes against the committed file versions; pre-existing module-runner
work stays in the worktree. No co-author or hook bypass was used. Before task
commits, initial SafeJS TypeScript contents changed only in the three intended
existing paths (restore, runner execute, runner execute tests); none disappeared.
The initial staged Safe Bash patch digest remained
`839e9e04f0f5e07fae2138a1c64a573e924875d6ccbb339c87774d51eaf251a8`.

Before these commits, local/remote main already diverged by **31 local / 60 remote
commits**. No force push, merge of unrelated work, or remote publication occurred.
Verified remote delivery and task release receipts remain **none**. This audit does
not close the task; release, agent coverage, and SM-REPLAY-1/2 remain open.
