# Approved fixture-only queued-close migration

August 27, 2026. Delegated implementation/validation only. The user explicitly
approved the exact proposal at `6dbd7d06f9c1901602b415773bb33ba1522a1c6e`
and independent review at `c6bcfe0d7734be0207d67b28a0ece0f12ed8becb`.
No product, runtime, contract, root-export, other canonical or historical file
was changed. No runtime handoff or acceptance is inferred from concurrent commits.

## Exact fixture change

Fixture-only commit: `10273352f8d65d929cbf5a23e69119414dacee60`.
Its only path is `tests/commands/regex-execution/followup/messageerror.test.ts`.
The entire original file was inspected and retained verbatim in
`evidence/original-messageerror.test.ts.txt` before modification.

The replacement is exactly the first TypeScript block in
`../PROPOSED-TEST-DELTA.md`; the new OPEN-queued companion is exactly its second
block. A byte-for-byte reconstruction from those proposal blocks passed against
the updated file. No other wording, helper, startup/active/precedence/native test,
surrounding idle setup, clean check or finally block changed. The closed owner
rejects queued and late work with CLOSED and awaits the exact retirement; the
new OPEN owner retains the valid replacement-worker success expectation.

| Object | SHA256 |
| --- | --- |
| Original canonical | `29b38d1603829e8f914410463b0537752aa585444a990e204b96948b92d14214` |
| Updated canonical | `1be27d16a8487dae108d0d80de2a6e443d1f6da0a0913461ebea768a8448a5c3` |
| Frozen current client | `1638d492d11d466875b98451a59bace4e60e71fcd5468d671182187549922bca` |
| Unchanged adjudication controls | `8703a61da44228731ffaf09f0f0fef5373d507458dd4d3dcb098460b704c9cda` |
| Replay harness | `4286f3770c475e6290fcf0a38f55e7cdd5955f61fedc883cffbbe066bba5906e` |

## Exact historical closure and selection

The original `cleanup-registration/isolate.mjs` and
`cleanup-registration/isolated-validation.json` were inspected, not executed or
rewritten. All **203** original materialized inputs still existed and matched
every recorded SHA256. The replay copied those exact bytes into one new owned
temporary snapshot, overlaying only the updated canonical fixture.

Every source/package/config input was additionally checked against approved
contract `07acb1a4d30b7592cf247a0220250317be4e2038`, except the exact historical
four-file overlay checked against registration
`01aa1bffe0568cc6787d5ff8e0331e024a787385`:
`src/commands/grep.ts`, `src/commands/search/rg.ts`,
`src/commands/regex-execution/client.ts`, and its `README.md`.
The live client matched that frozen registration before and after execution.
Live runtime changes were not copied. The historical client/approved-contract
closure, not today's repository HEAD, is the tested source identity.

The historical test argv was reused unchanged. Its six explicit inputs are:

- `tests/commands/regex-execution/executor.test.ts`
- `tests/commands/regex-execution/commands.test.ts`
- `tests/commands/regex-execution/followup/messageerror.test.ts`
- `tests/commands/regex-execution/continuation/glob.test.ts`
- `tests/commands/regex-execution/continuation/glob-transport.test.ts`
- `tests/commands/regex-execution/cleanup-registration/controls.test.ts`

These are the original 75 related safe tests plus the **original25** controls,
not the live29 controls with four supplemental additions. The added OPEN case
makes this replay101. `continuation/public-child.mjs` was preserved as an original
input, but its separate public-control command was not run. No original-five
public fixture or independent eight-variant probe was executed.

`evidence/replay-freeze.json` records every historical/replay input hash and the
single changed path. SHA256 of `JSON.stringify(replayFreeze.inputs)` is
`46eaa9f3721b6c2561a4b2a440241db07fe0189067fd749b3b2930186b0f408e`.
The 11 adjudication controls were copied byte-for-byte to their original relative
path in the isolated snapshot; no import or control-body transformation occurred.
Their historical exclusive-output runner and evidence were not overwritten.

## Commands and results

From the repository root, using installed tooling only:

```sh
node --check tests/stress/regex-execution/queued-close-adjudication/migration/replay.mjs
node --unhandled-rejections=strict tests/stress/regex-execution/queued-close-adjudication/migration/replay.mjs
```

The harness retains exact child argv, cwd, raw stdout/stderr, timestamps, PIDs,
exit/stream-close events and process-group checks in separate evidence JSONs.
It uses exclusive output creation; do not rerun into these historical outputs.
A later authorized replay needs a new owned destination with the same layout.
Missing or mismatched original inputs block execution rather than substitute a
different suite. No dependency installation, broad suite or external oracle ran.

| Check | Result |
| --- | --- |
| Original frozen closure build | pass, exit0 |
| Original25 scoped typecheck | pass, exit0 |
| Updated canonical + exact11 scoped strict NodeNext typecheck | pass, exit0 |
| Historical100 mapped to migrated expectations | **100/100**, one explicitly changed expectation |
| Added OPEN-queued companion | **1/1** |
| Migrated focused cohort | **101/101**, zero fail/cancel/skip/TODO |
| Exact unchanged adjudication controls | **11/11**, zero fail/cancel/skip/TODO |

`evidence/mapping.json` contains all100 historical names/results paired in order
with replay names/results, flags the one changed expectation, and separately
records the added case. The original **99/100 is not accepted or reclassified**.
These two replays have overlapping behaviors; they are not112 distinct guarantees.

Node `v22.22.2`, Darwin arm64, tsx `4.23.12`, TypeScript `5.9.3`.
Historical Node process isolation and default test concurrency were preserved.
The exact11 command retains its original isolation-none/concurrency1 profile.
All children inherit `NODE_OPTIONS=--unhandled-rejections=strict`; the11 command
also explicitly supplies the strict flag. Each invocation has a generous
120-second outer guard and16-MiB output cap on its exact owned process group.
No guard fired, no signal/forced cleanup occurred, and all five direct child
processes exited0 with both output streams closed and PID/process group absent.
This also checks absence of the historical Node test runner's process descendants.

Original25 diagnostics report20 controlled workers, active0, listeners0,
pathological allocations0. Executor diagnostics report17 native observed workers,
active-before-safety0, active-after0 and remaining-owned-listeners0. These are
their scoped counters, not a claimed total native-worker census for all101 tests.
The adjudication controls retain their exact retirement/listener assertions.
No new risky expressions or exposure were introduced: all six risky probes UNUSED.

## Preservation, coordination and limits

The pre-edit freeze began `2026-08-27T08:13:10.829Z`; replay finish was
`2026-08-27T08:16:32.916Z`. These are measured checkpoint times, not a72-hour
work claim. All203 archived input bytes and71 frozen historical files remained
unchanged, including original-five source bodies checked against `839f2d4`.
The original targeted **before1/1, registration0/1, current0/1**, original-five
**0/5**, and native-fixture **110/111** remain intact and were not rerun here.

Two pre-replay bookkeeping checks failed, not product tests: an unchecked default
`spawnSync` buffer truncated a full-index read; a corrected16-MiB read then
detected concurrent WebDAV commits rather than index damage. The exact-proposal
assertion had already passed; the semicolon-separated shell had continued to the
explicit fixture-only commit after the first bookkeeping assertion. The corrected
validation verified its single committed path and preserved both issues plus the
concurrent commits/index-path changes in `evidence/fixture.json`. No foreign
index entry was restored or included. The index was unchanged during the replay.

The exact owned snapshot was removed; all recorded child groups were absent at
finish. Evidence is committed separately with explicit owned file paths only;
`migration/review/**` belongs to the other reviewer and is not authored, staged or
claimed here. That reviewer independently owns the8 variants and targeted two
canonical tests. Runtime still requires the user/root-relayed frozen Sagan
handoff. This is fixture migration evidence only, not runtime/public/default
acceptance, full-suite parity, superiority or final project completion.
