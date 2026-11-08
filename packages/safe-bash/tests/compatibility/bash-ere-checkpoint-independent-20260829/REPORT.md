# Independent PUREERE R02 checkpoint review — HOLD

2026-08-29. **R02-only HOLD: a remaining parser-loop checkpoint omission is
reproduced in all three layouts.** The repaired history comparator and the eight
author checkpoint protocols pass. This is not ROOT or full-engine acceptance.

## Immutable source and execution

- Source/preseal author commit: `0e97500f41be479e4a266037b03230ab5118d300`.
- Independent pre-execution commit: `b2ff9a3dfaa2392c5d27d37d280154df732f3351`.
- Independent executable SHA256:
  `1211bb61a49e55f154570cb6bd57f3a1d076579c13822fc48fd5db881369328d`.
- Author seal SHA256:
  `20ce8940d07d2c032e4d61d321fbdee68e9e5fb6e1b5a4ca96dbc77de88097d7`.
- matcher.ts: `455c506467353c96eea0d55349c04c013be8ee53d6f8282982a9dd5d438871e8`.
- syntax.ts: `be0082e84d90783731163aa3a92fa3fc56b379c2c8c522fee567bafc5654b64f`.
- Actual restored matcher.js: `9faff63c6a4e877272a05f389941d54b044e28cb722820f77a7fda5303149deb`.
- Actual restored syntax.js: `1e23a00c14bd8d759fba8921feb044aafa139f0777be4a3b4a9c9081a6857b82`.

SOURCE-GIT.json binds all five module files to actual blobs of that source commit;
no moving HEAD or derived-object-existence assumption. Accepted Unit3 is the
declared baseline, with f97fd060 engine and R02 only. Actual compilation/load
closure is the standalone five-file module, not a whole core/package rebuild.
Installed means authenticated regular-file artifact placement; physical move
removes the original app location. No npm/full-package integration is claimed.

## Actual membership and status

| Cohort | Source-built | Installed artifact | Physically moved |
| --- | --- | --- | --- |
| Unchanged author66, including E12 | 66 PASS | 66 PASS | 66 PASS |
| Unchanged R02 checkpoint C01–C08 | 8 PASS | 8 PASS | 8 PASS |
| Independent N01–N06 | 5 PASS /1 FAIL | 5 PASS /1 FAIL | 5 PASS /1 FAIL |

**Main total237 PASS /3 FAIL /240**, no omitted main groups or retries. All three
failures are N01. The coordinator and outer both exit1 naturally; exit1 is not
masked by the successful retained or mutation controls. Separate roles:

- Six type executions:3 positive exit0,3 negative exit2 with exactly
  TS2345/TS2339/TS2322 at the unchanged consumer's lines4/6/7 (nine diagnostics).
  Rejection and intended diagnostics are checked, not a generic exit2 assumption.
- Three actually loaded original-method reversions are detected: historyOrder
  gap65030, count gap1026, set gap1026. All three semantic restores pass.
- Two DATA binding refusals exercise the actual bound-file function for altered
  content and missing file. They are not arbitrary runtime sandbox-denial proofs.

## Finding R02-I01 — first fragment pass bypasses work checkpoints

Frozen repro: `novel.mjs:52`, N01-empty-fragment-first-pass.

```js
const fragments = Array.from({ length: 2048 }, () => ({ text: '', literal: true }));
fragments.push({ text: 'a', literal: true });
const program = await compileEre(fragments, ledger);
await matchEre(program, 'a', ledger);
```

The real ledger is subclassed only to record unit work charges between actual
checkpoint calls; it delegates to the unchanged charge/checkpoint implementation.
Limits remain maxExpansionBytes1048576/maxExpansionFields8192/work10000. The
successful match remains `['a']`. The cadence assertion fails with **2050 unit
work charges between checkpoint calls**, identically in all three layouts.

Source: `src/commands/regex-execution/ere/syntax.ts:46`–54. Each fragment charges
one work unit, then awaits admitAscii(fragment.text). For an empty fragment,
admitAscii's loop runs zero iterations and invokes no ledger checkpoint. The
first checkpoint occurs in the final nonempty fragment, after the whole initial
empty-fragment prefix. The second flatten pass's checkpoint is too late.

This is **not** a claim that JavaScript performs no await: the empty async scan
still yields through Promise microtasks. It does not reach the ledger's charged
work/setImmediate checkpoint. No timer-delay/RSS/native-preemption measurement
is inferred from2050. Caller checks on charge remain; the finding concerns the
requested work-based awaited checkpoint cadence, not loss of all cancellation.

The first-pass source bytes are independently equal to authenticated f97fd060
snapshot bytes (RESULT-SUMMARY.json records their digest). This is a pre-existing
analogous parser-loop omission left by R02, **not proven newly introduced** by
the repair. Minimal proposed owner fix: await the existing ledger checkpoint
after each first-pass fragment work charge, including empty fragments. Preserve
charges/caps/capture semantics/private error boundaries; no public API or ledger
reset is needed. No product patch is made by this reviewer.

## Other independent observations and qualifications

N02 passes a real1200-unit parser metadata reservation followed by checkpoint
before another work charge; this is not preemption inside native some/every.
N03 passes an actual scheduled immediate abort(false) inside range parsing and
awaits its owned aborter. N04 preserves an exact undefined rejection from a
trusted ledger checkpoint in historyOrder; this is deliberately not an
AbortController.abort(undefined) assertion. N05 preserves cumulative compile
work and private EreProfileLimitError/status3. N06 preserves pre-aborted caller0
over an exhausted work allowance. None changes public ShellLimitError/Budget.

The original historyOrder repair passes C01–C08 with its ledger-work criterion;
checkpoint return awaits the real ledger's before/after-yield caller checks.
Instrumentation adds observation overhead, so cadence counts are not latency or
performance benchmarks. Fixed small loops, bounded scans and source-only branches
are not promoted to universal instruction preemption.

## R01 and native boundary remain untouched

Sagan I01/I02/I03/I04/I05/I06/I23 remain the same seven capture-reporting
failures/HOLD under cbf196073eb17b078355a1d7cb2e051a422413e1 and
08e40d411dc47bd725cb138e7d419ef2079a2879 authority. They were NOT rerun or rescored.
The GNU-documented model conflict is not a proven Bash/libc defect. No reset
policy is chosen; E12 and all66 original author expectations are unchanged.
Native capture,32 reference programs and8 host protocols remain unrun here.

## Capture, integrity and ownership

Outer PID56941 observed coordinator56944 exit1/close1, signal-null;22 direct
execution children all retired naturally, active0, no rescue signals. Actual
runtime roles24; peak outer+coordinator+one child3. Zero loader threads and zero
Regex/product Workers. Runtime5472ms; child raw capture64124 bytes, outer child
capture0. All raw statuses, including expected negative/mutant exits, are retained.

Post-DATA verification reauthenticates269 inputs and exact append-sensitive
273-regular-file work inventory,26184940 bytes. Source, restored emits, fixtures,
tool closure and owned-work contents match. This is not a private/global-tree
guard. No compressed artifact was used; the mandatory hash-before-inflate policy
was neither exercised nor bypassed. No native/engine-provider/private/network/
comparator/XAN/P2/oldgate, Shell =~ or transport execution occurred.

Preparation used conservative28 known launch-role slots within32; actual24
execution roles and bounded metadata/publication roles are separately recorded.
These counts include editing/admin allowances, not an exact universal descendant
census or evidence of unobserved worker exits. Instruction reads stayed separate
from raw evidence. Preparation text-inspection tool displays were truncated;
their full source/data bytes remain in the owned raw files, not lost captures.

The owned ACTUAL-01/work tree remains deliberately retained and untracked for
reproduction; it is not vendored into this evidence commit. No productive process
is left running and no historical/foreign root is cleaned. Tracked evidence and
foreign staging are checked at publication. R02 remains HOLD for the reported
parser omission; no ROOT/full-engine acceptance record is issued.
