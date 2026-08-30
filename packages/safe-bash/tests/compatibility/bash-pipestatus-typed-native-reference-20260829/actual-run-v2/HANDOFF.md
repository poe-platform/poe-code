# Typed PIPESTATUS six native observations

One exact approved attempt completed on August 29, 2026, using the previously authenticated local `/bin/bash` 3.2.57. Six observations, not parity passes or a selected implementation policy. The earlier prelaunch locator refusal `e66b4440fbfdb8b03b167f2402a6a9a77dbbfb1c` remains unchanged.

## Exact outputs

All strings below include their final LF. P19 and P20 have empty stdout, status 1, and identical stderr:

```text
pipestatus-typed-case: line 0: declare: PIPESTATUS: not found
```

P21 has status 0, empty stderr, and stdout:

```text
declare -ar PIPESTATUS='([0]="0")'
```

P22 has status 0, empty stderr, and stdout:

```text
declare -- PIPESTATUS=""
declare -a PIPESTATUS='([0]="0")'
```

P23 has status 0, empty stderr, and stdout:

```text
declare -a PIPESTATUS='([0]="1" [1]="0")'
declare -a PIPESTATUS='([0]="0")'
```

P24 has status 0, empty stderr, and stdout:

```text
declare -- PIPESTATUS="seed"
```

P19 retained `declare` as the first command with no prologue. These are printed-variable observations at the exact scripted points: no hidden-state, other-version/platform, or general initialization theorem is asserted. P20's absent declaration is not the same setup as P21's already-indexed binding. P22 and P23 distinguish the printed local scalar and local indexed states; P24 prints the scalar value. ROOT policy adjudication and different artifact review remain pending.

## Binding and minimal correction

The v2 coordinator uses exactly the absolute `activation-slot-v1/RECEIPT.json` path, stored blob `d6e04329ee5ced7ebf61c7e6da3e65b4bd923072`, size from the frozen `e0f1dc4b4228ef346d752bd82346b1d8b1902e4e` tree, and SHA `fd1a6b994c79a0f9346d1458d5fa29ee1f44808cca76d0e87abf0d63bf7d40a2`. One PURE fixture accepted this receipt and rejected a modified hash. No locator heuristic remains. Original source and all six owner programs were unchanged.

Fresh preflight passed at `2026-08-29T14:30:57.620Z`. The exact approved `exec_command` request retained command SHA `fdc96c5fb856284fa79287a1ff30869fa82c2d90e96f0ce34426acfac430a464`, `require_escalated`, `login:false`, no prefix, and the frozen approval question. Its tool result `75018f` completed exit 0; no session remained to poll or stop. This tool transcript is the owner-retirement observation, separate from the owner's pre-exit ledger.

## Raw capture and retirement

Raw native files total 25,569 bytes, copied and SHA-bound before typed-output extraction in `OBSERVATIONS.json`. The original temporary files remain intact. Each case row records `retired:true`, `stop:null`, regular capture completion, and its detailed exit/close/group observations. All six cases were credited; `halted:false`. The persisted ledger has seven confirmed managed starts, peak two, active one because the owner had not yet exited when it wrote the ledger. The subsequent tool exit 0 closes that owner; this is not an inferred leak or a fabricated post-exit ledger mutation.

The phase starts at the retained startup capture and ends no later than epoch milliseconds `1788014344559.4192` (600 seconds inclusive); this is earlier than the fixed grant expiry. Collection was at `2026-08-29T14:31:18.328Z`. Publication and post-admission guards use that same phase deadline, not a renewed clock.

## Finite roles and qualifications

The final plan uses 18 known administrative OS starts: startup/capture/Git 4, authorship 2, two syntax checks plus preflight owner 3, preflight display 1, collector 1, result display 1, sealing/edit/syntax owner 3, final stage/check/commit 3. Together with seven managed starts and four UNOBSERVED source-stage reservations this fits the 29-slot proposal. Administrative and native sequences did not overlap; managed peak is two. Native internal-stage reservations are not observed process starts; there is no universal OS census, OS containment, or enforced all-fork quota claim. All observed tool sessions and known children retired; no background cleanup obligation is handed off.

No repeat Bash version probe, native retry, alternate approval, product/ERE engine, Worker, compiler/build, network, P2 or comparator execution occurred. Empty stdin, no input fixtures, no allowed effects/lookups, and owned empty PATH are unchanged. Initial tool/zsh startup is a trusted host boundary outside the child fresh-environment/raw-capture qualification. The preexec NUL qualification stays transcript-only; actual raw files provide this new observational evidence. No GNU 5.3 or full Bash claim follows. Stop for independent artifact audit and ROOT adjudication.
