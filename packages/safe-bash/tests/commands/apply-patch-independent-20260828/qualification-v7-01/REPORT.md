# V7 exact qualification — captured permission refusal, no retry

August 28, 2026. This is the one actual qualification authorized after the
operator127 command error. No delegation or additional CLI agent was used.
Product execution, compilation, native oracles and successor admission remain zero.

## Preserved authority and preparation

- Source: `90311c10a0a95f8de7c889b2bd8395d4e95a1d37`.
- Evidence: `46bb1a6eceac656ca350d8c3a6dd2c075ffb13ba`.
- Fullseal commit: `24d58578cdbdd0cb9a4d8f03ff145bcc55801c4b`.
- Fullseal SHA256: `5522e85e1cb99c8da5e36c2113df2953ad89ba4b3e843dcd5d8c7989aa602ad6`.
- Discovery preseal: `f83d5102f3ac3c8d3d2a3645cb81b4c9291ccab5cf8a0da7c7ba4363d0fa5530`.
- Launch SHA256: `f54f4c8c98a97761434a3f89ee277f8967482e84d4b812ed670fc4820699f41c`.

Before launch, direct Node metadata inspection authenticated the fullseal blob
against its stored Git commit/tree/blob chain, 21 fullseal files, seven recipe
files, 50 source bindings and both exact tool binaries. SHA256, length and mode
checks passed. The intended runroot was absent; its existing parent's realpath
matched the literal parent. The owned Git status was empty before evidence writes.
No sealed file or permission argument was edited.

The literal Node executable was
`/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node`. The exact `LAUNCH.json`
command, cwd, `login:false`, tty and output parameters were used once.

`OPERATOR-127-TRANSCRIPTION.txt` preserves the earlier tool-rendered operator
failure separately. It is NOT raw qualification output. Its 10,190 bytes hash to
`d768bea239c498cd2756052d2b46e48a0d4bb5092c95fcf2a42db8342d9b45ec`.
Historical v5/v6/v7 preparation counts, transcriptions and failures are unchanged.

## Actual result

Owner PID 46983 started at `2026-08-28T21:42:49.842Z`, with pre-existing tool
parent PID 79787. It exited 1 naturally. Its terminal summary reports 472.503ms;
the earlier persisted OUTCOME timestamp reports 468.318709ms.

1. D00 PID 46984 exited 0, close observed and exact PID absence checked.
   The raw observed finite environment was exactly
   `{"__CF_USER_TEXT_ENCODING":"0x1F5:0x0:0x0"}`. Discovery qualified.
2. START-POSITIVE PID 46985 exited 1, close observed and exact PID absence checked.
   Its raw stdout emitted R01 and R02 result records before the failure.
   These are two observed partial records, NOT accepted cohort passes: the owner
   only admits the child results after the expected exit status succeeds.

The positive child failed at `recipe/data-controls.mjs:46` while preparing the
R03 symlink fixture:

```text
Error [ERR_ACCESS_DENIED]: fs.symlink API requires full fs.read and fs.write permissions.
    at Object.symlinkSync (node:fs:1879:11)
    at runDataControls (.../recipe/data-controls.mjs:46:6)
```

The error's `code` is `ERR_ACCESS_DENIED`; `permission` and `resource` are empty
strings. Node reports version v22.22.2. This is an actual captured intrinsic API
refusal under the unchanged finite grants, not the earlier outer journal error,
not a wrong Node path, and not a product failure. No full-filesystem grant,
permission removal, alternate execution route or retry was attempted.

The owner then stopped at its expected-exit assertion (`owner.mjs:229`, called
at line291). Accepted controls are **0/6**, DATA **0/4**. G01/P01, the intentional
environment refusal and the separately planned startup-open-refusal were UNRUN.
The unexpected positive-child refusal demonstrates actual raw error capture;
it must not be counted as the planned startup-open-refusal control passing.

## Capture, cleanup and process accounting

Raw pipes retained exactly 1,171 bytes: D00 stdout118/stderr0 and START-POSITIVE
stdout405/stderr648. The latter stderr SHA256 is
`561a32ea914a67f7ab4d4429d3c30ef8b9f9ae7991d4986b6f209c1c00bdaf10`.
The owner reports 29,894 persisted bytes. Its ten manifest-referenced records,
plus RAW-MEMBERSHIP and OUTCOME, form the exact twelve-file run directory.
Postflight rechecked every referenced record's bytes/hash/mode and exact directory
membership. All 21 pre-existing sealed v7 files remained byte/mode identical.

The owner removed its identity-checked scratch tree: 484 bytes, 16 entries,
inventory SHA256 `714d0af971b309b263da0ce8c1b1aa65916c319414ce2d9e33282bc5bf380ad5`.
Raw evidence remains intentionally retained. Both admitted children had terminal
close receipts and absence checks before owner settlement; the owner tool handle
also returned terminal exit1. There are no continuing tool sessions or servers.

The qualification subject graph was one owner, which also owned capture, plus
one sequential child: peak2 INCLUDING the trusted capture owner, not peak2 plus
an omitted capture process. The preparatory metadata route was one Node plus
one direct Git status process, also peak2. No concurrent observer or administrative
process ran while the qualification owner was active. This is finite owned-route
and handle evidence, not an OS-wide census; pre-existing tool infrastructure is
not claimed as a newly owned process. G01 did not execute, so flat subject Git
qualification is NOT dynamically established by this run.

Fresh process ledger: four preparatory Node admissions, one direct preparatory
Git status, one qualification owner, two admitted qualification children, and one
postflight Node = nine completed admissions before this report. The remaining
three reserved admissions are the exec-replacing apply_patch report writer,
direct Git add, and direct Git commit. Their terminal tool receipts determine
completion; they are not qualification children or hidden administrative helpers.
All metadata/qualification/cleanup occurred after the recorded preparation start
`2026-08-28T21:40:06.054Z`. No additional probing or replay is authorized here.

## Narrow next decision

The exact blocking operation is symlink FIXTURE CREATION inside the restricted
positive child. A possible future source repair is trusted-outer creation of the
exact presealed symlink fixture before child startup, while retaining child-side
alias rejection checks and finite grants. That is a proposal only: its path,
target, creation ordering and unchanged R03 assertions require source review and
a new versioned seal/authorization. Do not grant unrestricted fs access to make
this fixture green. No current recipe was changed.

Candidate `753f33d2fa1a2ccd86089c563d4ad66b9a1ae26d`, derived source tree
`6a59ca403c5411344dea2ee057909ba179bf7043`, and the prior S54 source-only proposal
remain unexecuted. No new product profile is represented as admission-ready.
Original32+80, old43 UNRUN and all historical failed cohorts remain unchanged.
