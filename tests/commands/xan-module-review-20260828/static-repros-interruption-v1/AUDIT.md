# Interrupted minimal-reproduction receipt audit

Read-only leaf investigation, August 28, 2026. Only this new audit directory is
owned. Parent coordination policy and repository rules apply. No candidate/test
script was executed, imported, retried or modified during this audit. No build,
runtime, typecheck, negative probe, dependency/network activity, source-semantic
re-investigation or process termination was performed. The preceding runner
safety block was not bypassed. This is an artifact audit, not a workload retry.

## Exact bindings

- Original scope: `tests/commands/xan-module-review-20260828/static-repros-v1/`.
- Preseal commit: `08dd69d06a2f40edd31263631605ae153a9cf318`, committed at
  `2026-08-28T06:59:51Z`; message: `test(xan): preseal bounded static-claim reproductions`.
- Original scope Git tree: `8d09caafedc8d0591617639b3648045745f480d5`.
- `PRE-SEAL.json`: 2,165,548 bytes; SHA-256
  `fae62845e4754eadd1bb2b7c42ebe81e29f59484e8adef0dc0b0540bc993aa33`;
  Git blob `ab0b747426515202991b7530e36198196e542923`.
- Preseal timestamp: `2026-08-28T06:59:34.883Z`; recorded attempt limit 1,
  `candidateExecutionsBeforeSeal: 0`.
- User-specified normative freeze: `55810d4aea70fadf151c2fbf746a17f96bfeb599`.
- Candidate: `0ec84fc38c3fafd75776d80148d4f3c2d77e6247`, also recorded as
  `binding.audit` in the preseal. Neither binding was re-executed here.
- Prior log: `/tmp/xan-static-minimal-repros.UsFC5y/session.log`, 422,801 bytes,
  5,735 lines; SHA-256
  `67289f6a3b7b184b285f3b297082ad5982b693f1499c9fd717a2947f5ed06096`.

## Issuance and interruption

The log contains 22 `exec` records. It records preparation and synthetic
qualification (`prepare.mjs`, command ending at line 4266), and earlier Node
syntax checks; these are historical activity, not activity of this auditor.
The last `exec` starts at line 5224 and commits the preseal, resolves HEAD and
checks scoped status. No `run.mjs COMMIT` execution command is recorded.

At line 5730 the agent says, “Preseal committed. I’m starting the single bounded
attempt.” Lines 5732–5733 contain two cybersecurity-risk tool errors, followed
only by token accounting. There is no subsequent tool invocation or product
start receipt. The log directory has `session.log` only; `final.txt` is absent.
The commentary is intent, not evidence of issuance or start. Available records
do not evidence an actual product attempt; they cannot prove activity outside
their coverage. The coordinator/tool interruption is not a product finding.

## Existing synthetic receipts

All references in this section are under the original scope's `qualification/`.
`CONTROLS.json` SHA-256 is
`79ded58f010ca7b80c294c9b193bf14d78de60704f9d1fc8b948bddce38dee25`.

| Control | PID | Exit code | Signal | Timeout | Reaped | End UTC |
| --- | --- | --- | --- | --- | --- | --- |
| pass | 25323 | 0 | null | false | true | 2026-08-28T06:59:34.251Z |
| fail | 25326 | 1 | null | false | true | 2026-08-28T06:59:34.406Z |
| timeout | 25327 | null | SIGTERM | true | true | 2026-08-28T06:59:34.805Z |

Each `START.json` identifies `worker.mjs synthetic CONTROL`; all three receipts
record no spawn error or overflow. Raw stdout is respectively the newline-ended
JSON `{"synthetic":"pass"}`, `{"synthetic":"fail"}` and
`{"synthetic":"timeout"}` (21, 21 and 24 bytes). All stderr artifacts are empty.
All six raw byte counts and SHA-256 hashes match their receipts. All 13 files
bound by the preseal qualification inventory match their sealed hashes/lengths.
`CONTROLS.json` records four counterfeit rejections and `candidateExecuted: false`;
the counterfeit checks were not rerun. These are synthetic outcomes only.
The timeout's SIGTERM is historical receipt data, not an auditor action.

## Missing product receipts and process state

The live original scope contains exactly the 22 committed files, including
ignored-file inspection; all 22 match the preseal commit byte-for-byte. Its only
child directory is `qualification`. `attempt-1` is absent. Thus no observed
`attempt-1/PRE-RUN.json`, job, child START/RECEIPT, product stdout/stderr raw,
ADMISSION-PRE, CASE or aggregate RESULT artifact exists in that scope.
Missing data was not synthesized or scored. Fourteen prepared cases across two
layouts (28 planned observations) remain without execution evidence/results;
none is a product pass, failure or timeout established by this interruption.

At `2026-08-28T07:02:37Z`, `ps -p 25323,25326,25327` returned no process rows.
At `2026-08-28T07:03:10.747870Z`, inspection of PID/PPID/PGID/elapsed/state/command
records found no original-scope workload command or original-log process.
Auditor coordination PID 28148 and inspection shell PID 33486 were excluded as
this audit's own activity, not candidate survivors. No owned workload survivor
was observed, so no survivor PID/command/elapsed is available to report. This is
a bounded process snapshot, not a universal ancestry or process-history proof.
No process was signalled or stopped. If root observes a survivor later, root
must decide its disposition; this audit grants no termination or retry authority.

## Limits and handoff

The original mixed cohort remains SOURCE 569/79/19, MOVED 570/79/18, with the
original compiler failure unchanged. These are preserved context, not newly
verified results. This separate minimal-reproduction interruption neither
rescales that cohort nor resolves its findings. The other reviewer's
`diagnosis-v1` and all original evidence remain untouched.

Blocker: the original tool safety error interrupted coordination before any
recorded product-run issuance. Stop here; do not retry, rescore or bypass it.
Validation for this audit is limited to artifact bytes/hashes, Git metadata,
bounded log inspection, process snapshots and documentation whitespace checks.
