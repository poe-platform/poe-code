# Independent preexecution review — approval withheld pending launcher corrections

Date: 2026-08-29. Reviewer: delegated independent source/DATA reviewer, not
Faraday (proposal author). No reference activation or approval request issued.

## Frozen authority and scope

- Source: `9afc9c5a321711fb566817916a281fe4776935fd`.
- Evidence: `807b6ea5f934e7b9d23092c6d7f518b757b8fbea`.
- PRESEAL: `657d5ef886db90c625d40ba4f461ccea64c1ff9e2d48f3b1c72190bc0d52dea6`.
- Launcher: `c93248b64eb33cd2c363351ba393a42f7858210b95537fdd6bbef257d1664147`.
- Proposed approval request: `3275cbb00a768c8b8ef6166c8e172df23bb4c9e18b26821eea089c2fa20f8b9a`.

SOURCE and evidence stored objects were independently read and hash-bound,
including original forty programs, four fixtures and historical version
artifacts. No derived Git identity was requested. `RESULT.json` is the actual
control receipt; `CASE-MATRIX.json` classifies every identity, not just samples.
The source-only synthetics below are NOT native/lifecycle experiments.

Actual controls: original 9/10, with C05 failing because the reviewer mistakenly
required readarray at the start of B21 instead of after its literal assignment.
That raw failure is unchanged. `CORRECTION.json` records separately versioned
C05-v2 against complete original literals; it is not an extra semantic case or
replay of the other nine controls. One Node syntax-only check accepted the
launcher; no launcher body, Bash, product or real lifecycle child was executed.

All nine metadata/syntax children (four collection Git children, four authority
Git children and one syntax child) retired. The review's direct orchestration
also used bounded shell/read/edit/Node/Git publication roles; no kernel birth
census is claimed. The conservative launch-role ledger through publication is
at most64 starts (including edit-wrapper allowance), serial metadata/controls,
peak at most3. Instruction reads were context only and are not evidence files.
Logical evidence size is recorded in SEAL.json, excluding that seal itself;
stream-hashed tool bytes were not dumped or copied. No lingering owned session.

## Literal audit: proposed 37 may retain their exact programs

No additional case exclusion was found necessary from literal host effects.
All command positions are builtins, literal local functions or the three
explicit failed-lookup exceptions. Expansion/glob matches are printf arguments,
not command names. B09 substitution, B14/B15/B35 functions, B37 source/eval and
B38 EXIT trap bodies were separately inspected. There is no external shebang,
successful external executable request, socket path, `/dev/tcp`, `/dev/udp`,
host-file redirect, arbitrary slash command, background job or session escape
in the proposed literals. This is a finite trusted-literal audit, not a general
shell parser proof or an OS denial policy.

- B20: only `mapfile`, candidate path `<runRoot>/B20/empty-path/mapfile`.
- B21: only `readarray`, candidate path `<runRoot>/B21/empty-path/readarray`.
- B39: only `__surface_missing_command__`, candidate path
  `<runRoot>/B39/empty-path/__surface_missing_command__`.
- runRoot is exactly `/private/tmp/safe-bash-surface-functional-v1-20260829-01`.
  These are single-component absolute PATH entries created fresh and empty;
  no empty PATH component, ambient fallback or successful external capability
  is authorized. Request environments are exact six-key maps. No BASH_ENV,
  startup functions, NODE_OPTIONS, user HOME, ambient PWD or loader variables
  are forwarded to Bash. `--noprofile --norc -c` is explicit.
- B10–B13 read owned directory names. B23/B25 may create only `work/out`;
  B23 reads that file. B37 reads only `./source-fixture` (37 bytes): literal
  assignment and printf. Other fixture payloads are A/LF, B/LF and H/LF.
- B26/B27 remain WITHHELD: Apple3.2 here-document/string temporary placement
  not established. B28 remains WITHHELD: old-parser dynamic-fd/exec lookup
  interpretation unqualified. No substitution program or new expected result.
- B23 `read -N`, B24 `|&`, and B36 `;&` support must be observed literally;
  a syntax/option rejection is an observation, not a modern-Bash success.

## Launcher corrections needed before accepting this exact approval command

### F1 — capture-finalization errors can still count a completed observation

`packet/20.data:72` catches fsync errors by setting `halted` and appending
`row.errors`, but does not set `row.stop`. At line75 completion depends only on
exit, close, absent group and no stop; line77 can increment completed anyway.
C09 reproduces that exact predicate with an EIO-shaped DATA row: halted=true,
errors nonempty, regularCaptureCompletion=true. No real fsync was faulted.
Require finalization success in observation eligibility; retain raw output and
first stop/error rather than converting a capture failure into an observation.

### F2 — residual owned groups are signalled but not drained/re-observed

`packet/20.data:65–72`: after direct close, one group observation may be present;
the launcher sends KILL and immediately clears all timers. There is no later
group observation/await. The catch path similarly signals and can unref a child
without observing its retirement. This does correctly mark STOP, not success,
but does not establish cleanup of resources it just signalled. Preserve
present/absent/unknown distinctions; perform bounded remaining cleanup and
re-observe, with unknown retirement remaining STOP/no dependent admission.
Do not replace the current group observer with a claimed descendant census.
Early overflow/error TERM also leaves KILL scheduled at case-start+5s, not
first-stop+2s; specify/implement the promised two-second cleanup origin.

### F3 — startup capture and receipt admission are incomplete

`packet/20.data:1–21`: module loading, mkdir and journal open precede the owned
try/capture boundary. The proposed tool command does not establish a durable
outer raw stdout/stderr capture before these fallible operations. A root-path
collision therefore bypasses OUTER.jsonl. Tool-console capture alone is not
the promised independently retained startup artifact. Add a sealed outer
capture/dispatch boundary, without executing a different unbound command.
`packet/20.data:26` tests independentReviewAccepted=true but never validates
independentReviewReceipt, which can remain null. Root must bind the exact
accepted receipt and validate it before Bash acquisition. Tool approval is a
separate host authority, not something this JSON boolean itself proves.

### F4 — distinguish planning figures from actual enforced accounting

The equation 1 controller +37 Bash +13 source fork reservations +1 outer shell
+12 administrative allowance =64 is arithmetically coherent. It is NOT a hard
all-process quota. Only direct Bash starts and the 13 declared reservations are
checked by launch.mjs. The twelve admin starts have no concrete command list;
peak6 is a source planning bound, not measured/enforced concurrency. Enumerate
remaining actual admin executable/argv roles before final approval, including
any new outer-capture process. Do not silently borrow/reset allowances.

`totalWorkingBytes`, `allProcesses` and `peakProcesses` are not referenced by
the launcher. totalCaptureBytes counts accepted stdout/stderr bytes, not journal,
per-case JSON, duplicated aggregate/base64/snapshots or oversized retained files.
The 10ms regular-file poll is not a write barrier; overflow can overshoot.
Either enforce sampled aggregate storage/capture accounting with explicit
categories or supply an exact finite-literal storage derivation and accurately
name what is checked. FinalizationMs is reserved in case admission but not
checked during final snapshots/publication. Keep 10min inclusive with explicit
remaining-time checks, no hard post-KILL, blocking-FS or RSS guarantee.

## Positive boundaries and qualifications

The launcher admits exact argv/environment/request order and current Node,
Bash and env hashes; it authenticates the sealed local observer before import.
Regular stdout/stderr FDs open before spawn; error/exit/close are separate;
stdin is finite; first row.stop is generally preserved. Raw output is base64
and SHA256, with no trim/normalization. Stream EOF is correctly null for regular
files. Before/after snapshots preserve bytes/types/modes and reject unexpected
existing-file mutations, deletion and new entries except the two owned out
files. Snapshots are not an OS read-authority monitor. The future namespace
mapping changes only the case-root prefix to virtual `/`, not stdout/stderr.
Ordinary nonzero statuses remain raw functional observations.

Current metadata rehash and historical raw version evidence bind `/bin/bash`
1293840 bytes, mode0555, SHA256
`35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3`.
Historical probe commit `822e82a70dfebc071d3b6e27bc78967afa40a993` reports
3.2.57(1)-release arm64-apple-darwin25. No version probe repeated here. Loader
graph/runtime containment remains unqualified; binary metadata is not a fence.

## Concrete root decisions / next author action

1. The limited failed-name scope for B20/B21/B39 is source-supported exactly as
   listed. Root may retain its provisional permission; no broader name/PATH
   permission or further literal exclusion is requested.
2. Request a narrowly versioned launcher/approval reseal addressing F1–F4 and
   its finite DATA/lifecycle evidence. Do not change any of the forty programs,
   four fixture bodies, withheld identities or output expectations.
3. Only after that independent acceptance: root supplies a fresh exact receipt,
   deadline and grant; author requests the exact sealed command using
   require_escalated, login=false, noninteractive env and NO broad prefix rule.
   This reviewer has not issued that request or executed the entrypoint.

All37 prospective observations remain UNRUN; three withheld remain UNRUN.
Old9/40 containment HOLD, retired SIGABRT history and GNU5.3 build P2 remain
unchanged. This is not native fallback, GNU5.3 qualification, product acceptance,
security qualification, or a claim that tool approval creates OS containment.
