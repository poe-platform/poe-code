# Chronology repair: candidate for Locke

August28,2026. Author DATA/SYNTHETIC qualification only. **Different acceptance
and real CLI/OS qualification remain held.** Root cursor policies are unchanged.

## Frozen source and history

- Precode20 traces: `17f3760cfd0aee7ca900ca6e204d0758170989db`.
- Whole-module executor/baseline seal: `29d7aa75551dae9be54d89a612c5ef7c67e3cb6a`.
- Preserved baseline1/3 evidence: `09b95ead0a9aee1983858bf98c9bff9714519f8b`.
- **Candidate: `3d3a0371729b88ced47b6e37376676746b638ad9`.**
- Module seal SHA256:
  `b0006cdbbad9f3a0e75f48588e3e0d9ea6557924ae7aeb687ad6b88e7f27df14`.
- Changed framework source: **only modules/lifecycle.mjs**,25 added/9 removed
  lines versus de9dae6d; other seven module bodies, including node-driver, unchanged.
- Lifecycle SHA256:
  `176e55d98b2058daa121e4864ec84e450eaf3f1c2d4f7f716051577a5c14b645`.

Locke b1485454's47/49 unique predicates, original six6/6, direct8/8 including13
subprobes, initial30/31 stdout interruption and remaining17/18 all remain unchanged.
No peer fixtures were edited or rerun. Prior075fbe24 and author failures/captures
remain. This is not a49/49 claim or native/product rescore.

## Root-cause fix

Success now requires the valid arrival sequence awaiting-spawn → running → exited
→ closed. An out-of-order or duplicate spawn/exit/close permanently sets invalid
and records the first violation. Later flags or group absence cannot heal it.
All observed preterminal events still set their actual flags/counts; exit/close
logs retain code/signal, including differing duplicate values. Duplicate spawn
does not repeat the one-time spawn receipt write. No notification is fabricated.

Fault/escalation and group monitoring continue through existing cleanup. Invalid
traces prevent the next row, even when the group later disappears. Missing group
absence reaches the unchanged3000ms uncertain terminal bound. Legitimate no-process
error remains a failure without a fabricated spawn/exit/close. Stream errors are
not lifecycle duplicates. Original thrown objects/falsy reasons remain identical
through callback/cleanup/report paths. Postterminal callbacks retain handlers but
cannot mutate the settled report; their delivery is separately captured by the
model trace. No cap, real admission route, or product code changed.

## Actual results

| Cohort | Result | Scope |
| --- | --- | --- |
| New baseline selection on de9 module bytes | 1/3 | Natural passes; both peer invalid orders reproduce and admit a second modeled row |
| Candidate chronology | **20/20** | Whole node-driver → lifecycle → observer graph with finite injected primitives |
| Existing author control predicates | **37/37** | Current mode-aware direct-port model, unchanged predicate bodies |
| Existing versioned repair predicates | **27/27** | Includes the previously corrected post-publication mode test |

T03 exit+close1ms/spawn2ms/absent3ms now rejects at25 modeled ms; T04 exit1ms/
spawn2ms/close+absent3ms rejects at3 modeled ms. Both retain all three observed
flags, latch the exit violation at1ms, start only one modeled row, and leave N02
unexecuted. These are adversarial traces, **not claims Node emits that order**.

Controls additionally cover duplicate spawn/exit/close, reverse orders, normal
zero/nonzero completion, legitimate failed spawn, falsy first errors, repeated
errors, stream/cleanup failure identity, postterminal notifications, surviving
groups, and binary output after exit/before close with copied bytes preserved.
All model timers/descriptors drain; created model stdio are destroyed once and
retain error listeners. The deliberate surviving-group case records alive=true
at uncertain settlement, then discards only its in-memory model—no fake reaping.

Six complete module bodies are evaluated via Node's built-in VM linker; all eight
sources are bound. Only finite filesystem/child/process/timer stubs are exposed to
the actual driver. No source-body substitutions, real observer children, native43
recipes, product/private-engine imports or observer network operations occurred.
The read-only primary-document lookup is research, not a runtime/network cohort.
The parent experimental VM warning is retained as a qualification, not a failure
or a claim of OS behavior. No active task child remains.

Parent Nodev22.22.2 at `/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node`,
112989184 bytes/mode0755, SHA256
`5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011`.
Chronology command uses --experimental-vm-modules; the existing37/27 commands do
not. Captures include pre/post source/mode authentication and exact loaded body
hashes; no mutable product HEAD enters execution.

## Current captures

All under observer-v1/captures; unique names, no overwrite:

| File | Encoded SHA256 | Decoded bytes |
| --- | --- | --- |
| chronology-v4-candidate-1787928291780-21693.json.gz.base64 | `617da62f8c2e32819af3c412965e8c409fdd7ce382abc8b18b7e93af924f3cc0` | 92038 |
| synthetic-1787928292156-21704.json.gz.base64 | `5c678253eeda871b265f0a780ad912ced8b9e5831d9d36434b7a4ca416ca9fc5` | 1707694 |
| repair-v3-1787928292450-21660.json.gz.base64 | `357af713387f54fabcc5be8b5347af721c0fc1a79bbf3bfcb09c47ea066bfc98` | 64162 |

All fit the unchanged2MiB per-capture bound. The baseline raw failure and its
hashes are separately retained in CHRONOLOGY-BASELINE-v4. Original32 and additive11
Bash script/input bytes remain unchanged and unexecuted.

## Replay and next boundary

```sh
/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node --experimental-vm-modules tests/shell/mapfile-design-20260828/observer-v1/chronology-controls.mjs candidate
/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node tests/shell/mapfile-design-20260828/observer-v1/modules/synthetic.mjs
/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node tests/shell/mapfile-design-20260828/observer-v1/repair-controls.mjs
```

Freeze3d3a0371 and replay the different review with its original chronology
expectations. Do not substitute author20 for independent acceptance. A minimal
exact harmless-child qualification recipe remains queued **until synthetic review
is closed**; no OS child recipe is authorized or executed here. Real CLI wiring,
OS spawn/close ordering and group cleanup remain static-only. No mapfile/readarray
product, arrays, private input APIs, permission changes or root files were touched.
