# Independent acceptance: REFUSED on invalid revised fixture

August 27, 2026; one attempt, **11:39:07.346–11:39:49.184 UTC**. No retry,
author-fixture repair, source change, or later product execution. ROOT was told
of the first unexpected failure before this read-only evidence seal.

Reviewer thread `01a042ef-2082-7a20-a1b5-c3ba7235ff76` differs from author thread
`01a042ee-bfce-7b80-b667-af14bd426f64`. Criteria were frozen before author inputs
were read at `2fdc16ae8130830dc6f51c70cba540ca3716bc4c`; review execution inputs
were frozen at `6fc69ad4847699b54892cf0227ff18ff0011f9be`. Author inputs came
only from **`f2906a064d2558c634cdc1b71a7b74fd2f6d022a`**, never its moving files
or later results. Product remained **`84ab66ca717e0dff21abf57051b41cb553f3c7f3`**.

## First failure and authority

First revised packed case: `quotes-empty-concatenated`.

| Field | Original replay | Revised replay |
| --- | --- | --- |
| Status | 0 | **1** |
| stdout | Original NUL-delimited bytes | Exactly identical bytes |
| stderr | Empty | Three prototype-sensitive assertion diagnostics |
| Effects | `phase=seed`, mode0644 | Exactly identical bytes/mode |

Frozen `consumer-v1.mjs:67` compares `context.env` directly to plain `parentEnv`;
line79 compares it directly to the plain spread snapshot `before`. Candidate
`src/shell/runtime.ts:798` constructs `env` with `Object.create(null)`.
`src/contracts/command.ts:30` declares `Record<string,string>`, not an ordinary
Object prototype. Node strict deep equality distinguishes these representations.
The recorded diagnostics explicitly show `[Object: null prototype]` versus `{}`.

These new assertions run inside parentbefore, entry-finally and parentafter.
The shell reports their exceptions as command errors, contaminating primary
status/stderr. The outer fixture's serialized `error` is null and its native-row
`passed` field is absent; neither proves success. The independent raw-tuple
preservation gate detects the change and stops. The actual `record` command did
execute with the original literal argv; parent local values and copied exported
maps were captured, entry cleanup completed once, and plugin disposal completed.
Those observations do not make the invalid revised tuple acceptable.

This establishes a **fixture representation mistake**, not an env parser,
replacement, parent-state, or runtime source bug. Nothing is patched to make it
green. A new disclosed author freeze and ROOT release are necessary to proceed.

## Exact completed and unexecuted partitions

| Partition | This attempt |
| --- | --- |
| Original hidden primary | **40/48** strict exact; 8 retained losses |
| Original hidden hosts | **6/7**, original invalid invoke-input host still fails |
| Original packed assertions | **0/10** in each whole native profile; **0/5** hosts |
| Original packed raw tuples | **7/10** in each profile, not assertion passes |
| Revised hidden GNU9.7/Darwin primary | **40/48**: commands39/42; protocol1/6 |
| Revised hidden Apple/Bash3.2 historical | **23/48**: commands22/42; protocol1/6 |
| Additional primary virtual diagnostic checks | **3/3** exact; still 3 strict native losses |
| Revised hidden hosts | **7/7** actual public-package host groups |
| Revised packed native rows | **0/1 attempted**; remaining6 core + 3 protocol unexecuted |
| Revised packed hosts | **Unexecuted**, all5 executions in3 IDs |
| Author additional policy controls | **Unexecuted**, all12 |
| Reviewer independent controls C1–C6 | **Unexecuted**, all6 groups /14 runtime variants |

Both whole revised hidden profiles ran all48 IDs, including every protocol row;
the primary48 also had a separate original replay with identical input hashes
and actual tuples. All original10 packed rows and5 host executions ran on that
same package. Known five primary hidden protocol losses remain: four env-S126
refusals and non-S126 versus native127. Original packed three shebang/native
losses remain; their revised counterparts were not reached after the stop.
No unsupported or unexecuted row is labeled a pass. Whole immutable native
captures, quotes, byte tuples, modes and profile identities were retained;
there was no new native run, per-case oracle switch or stdout normalization.

The original hidden failing helper throws before returning its inner observation.
The new transport preserves that outer AssertionError; it does not invent inner
stderr/status. Its JSON transport exits0, explicitly **not** a fixture pass.
All94 original evidence files and all prior failures remain byte-identical.

## Additional static risks, not extra executed failures

- Author `consumer-v1.mjs:120–122` omits `export` from expected budget/cancel
  middleware sequences. The shared prefix visibly reaches export middleware in
  the first actual revised case. Budget/cancel rows themselves were not reached.
- The reviewer's unexecuted C1/C3/C5 controls also contain direct prototype-
  sensitive map assertions. C1's expected middleware sequence omits export.
  Its budget crosswalk omits the new export when removing setup witnesses too.
  These reviewer harness defects are disclosed, not silently fixed or treated
  as executed evidence. They must be resolved explicitly before a new attempt.
- The disclosed4 -> 7 budget offset, default-merge correction, cancellation and
  gated independent cleanup controls therefore **do not have revised packed
  acceptance** from this attempt. The hidden7-host pass does not replace them.

## Package authentication and closure

The complete committed **213 source + 7 root files** were rearchived and rebuilt,
including foreign source changes already present in84ab; no moving HEAD claim.
All708 emitted files match the old exact-candidate build. The original actual
630766-byte tgz was authenticated by SHA256/SHA1/SHA512 and safe tar inspection:
`3ac9f899fbabb14e0473a9345113642fbfd2d12ac6e957659695b6b9e2fbac8c`.

Offline npm installs that tgz into a clean external consumer, physically renamed
from `installation` to `moved-consumer`; the old path was absent before execution.
The package was a real directory, the only installed package. Bare public imports
resolved through its real manifest. Plain Node22.22.2 ran **172 product children**,
with **29,928 actual compiled JS loads**, all matching installed/tar hashes and no
host-process/fetch attempts. Every completed product has before/after checks of
all710 installed files, full source inputs and exact extracted fixture/helper
inputs, including the failing row. No aliases, source/tsx product, fake exports,
root/private install or runtime dependency was added.

Actual moved public declarations compile successfully. The separate original
invalid Uint8Array invoke binding yields exactly the expected TS2741 missing
async-iterator error; its exit2 is a successful negative **type check**, not a
runtime/native pass. Post-audit rechecks Node plus all247 compiler-tool files and
2039 npm files unchanged, original files and exact frozen revised hashes.

All **176 owned child groups** (172 product + 4 tooling) are absent, independently
rechecked after cleanup. Owned scratch, including archive/install/cache, is gone.
No watchdog, timeout, overflow, surviving group, rescue, watcher or retry occurred.
The normal success-tail checks were not reached: endpoint source/input/install
proof comes from the last paired product guard, and tooling from post-audit.
There is no post-removal archived-dist rehash claim.

## Durable evidence and disposition

- `acceptance-1.json`: untouched raw attempt, 19693407 bytes; SHA256
  `e444533f6eca373015b92b980032e876516552c591a568b922cdff3c863d8b36`.
- `post-attempt-audit.json`: exact counts, failure tuples, declaration output,
  before/after authentication, additional static risks and closure checks.
- `ACCEPTANCE_INPUTS.md`, `accept.mjs`, `independent-controls.mjs`: frozen
  controller provenance, explicit old/revised crosswalk policy and planned checks.

**REFUSE bounded core integration acceptance.** Useful hidden/core and genuine
package evidence is preserved, but revised packed validity and the independent
controls are not complete. No universal parity, full gate or source fix is claimed.
