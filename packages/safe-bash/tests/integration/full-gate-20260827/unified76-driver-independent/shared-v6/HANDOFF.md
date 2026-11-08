# Independent76 shared-slice receipt — qualified, no full-gate release

## Immutable bindings and chronology

- Candidate: `f5e9fc49b6abb38e180cc9de16c95fced102ff75`, base `44f00bf84278e3361b52106478d59c707ab7b2bc`.
- Shared driver source: `e062bcc1c79bf626541cc13ce35bad89e28dfe0a`; author evidence: `69a77055fb180f34d47c7e3e4306a666c0d96f68`. Handoff was read from the evidence commit, not a moving file or the source commit where it is absent.
- Raw DRIVER.json SHA256: `e8ac0521c44d6c76c5a1b670f89296caa65640291a24703f36bdbd8abfc8ce10`; canonical parsed-JSON SHA256: `3d8d2a15214f12c07b64e3223f5e0088989845b8f60a74abb0a521dba32fa018`. These are different representations, not contradictory identities.
- Expected/carried independent package SHA256: `c109372f90b1bd19bcf756cf993bb2976fb52b75fe0c92a1cf96dab4c229b5cd`. No tarball was produced here. Prior independent reproduction at `37b3c9c3c9c3e911286d0d8542c494f762e17015` is carried only after exact candidate/source/profile identity checks.
- Pinned Node24.11.1 real executable SHA256: `4255a388254ca4319e2f95f1da375d5deaddf25baf9c7c85070b67f9543b15d0`.
- New pinned bodies were inspected before the additive plan, not blindly. Original Phase-A/v2/v3 and v4/v5 chronology, bytes and counts remain unchanged. Initial plan commit: `59ffe78652669796db19592c48c9cd5c0b1477c6`; initial executable recipe: `271e2cb951a01a860dc983943fc73f6a13d7e91d`.
- Execution records span August28,2026 03:41:09–03:54:41 UTC, equivalent to August27 22:41:09–22:54:41 CDT. Directory labels are not used as execution timestamps.

## New actual results

**A10 passes in the final instruction-copy-free run.** Actual frozen `createBuildAudit`, `createPhaseRunner`/`supervise` and `runBuildTypes` are called directly. The final driver and author review entry import/call those same exports; exact callsites and source hashes are in `BINDINGS.json`. Neither full entrypoint nor a fork/stub/counter implementation is executed.

- Cold `npm run typecheck -- --report …`: exit78, zero production-build events.
- Actual `npm run typecheck:all -- --report …`: exit0, exactly one real audited production compiler invocation; one emitted declaration set reused by all typing groups.
- 23 maintained positive type groups, 3 source positive type groups, and 3 expected-negative groups. Negative compilers exit2 with exact 1/2/5 diagnostics. There are 32 compiler phases including production build, global source/tests and historical consumer. This is not 29 runtime/product passes; runtime executions are zero.
- 832 emitted files and 208 declarations. Full canonical emitted-receipt SHA256 `f628eb40fdd27ec3980f98c6b026238b316d345fc0eb759584c0b82d22a675b4` independently matches the author receipt. Files-array-only SHA256 is separately identified, not confused with the full receipt.
- **Genuine duplicate detection:** after sealing the positive one-build receipt, a second actual TypeScript production build completes0 against the same copied candidate and audit. Two real PIDs/argv/events exist. Frozen `readBuildAudit(audit)` throws `unexpected duplicate driver production build`; diagnostic maximum2 exposes both events. This is an API refusal caught by an expected-negative control, not a claimed CLI78 exit or permission for two driver-managed positive builds.

**Outer observer: 13/13 new independent subcontrols pass**, in one separate observer run, not an author-control replay. Actual outer `attachProcessObserver` and sandboxed `createObserverClient` observe four real Git groups. Ordinary bytes, two exact historical `controls/back\slash` candidate paths, another literal backslash pathname and contained links authenticate successfully. Traversal, `.git`, duplicate entry, link ancestor, wrong platform, real wrong-size/missing-object Git headers, escaping link, wrong token, foreign PID and unknown handle refuse. Inner `/bin/ps` and an outside-work write still fail EPERM. The review-owned foreign sentinel remains the same live PID/group/birth through watched-group cleanup, then is explicitly stopped by its controller. Negative transport APIs throw without exposing individual terminal statuses; those statuses are not fabricated. Positive transport returns0/null signal/closed/zero survivors.

## Preserved mistakes and replay history

No failed or noncompliant attempt is rescored or hidden:

1. Initial recipe exits1 before building: its sandbox omitted Darwin `/bin/sh` dispatch to `/bin/bash`. Observer controls pass independently. Freeze `872bfd39e1b36cde4926d7a877fb10a524d5bb9b` adds only the hash-bound executable permission.
2. Followup exits1: cold78 works, but `/usr/bin/git` is Apple's dispatch shim and its `xcodebuild` launch is denied. Zero builds. Freeze `9be9e9e9e3e70cd69d5d20f39dec1bac15e75cd8` places the already authenticated Xcode Git directory on clean PATH; it does not authorize xcodebuild.
3. Next run has two behavioral passes, but sealing finds a forbidden dependency instruction copy: `benchmarks/node_modules/just-bash/dist/AGENTS.md` (9231 bytes, SHA256 `1269340457d3ce77dff98082a4270125ff362c9ee7a4eee66574c280d8319979`). Three earlier temporary snapshots contained it. This was an independent harness policy violation, not a driver/product bug. `POLICY-COPY-INCIDENT.json` corrects prior `noAgentsCopies:true` implications; every original result remains. No instruction body is retained in evidence. All three trees were hash-receipted and removed.
4. Freeze `888f01f4ff8703c5351a6b3ee86353f7a7f96046` omits that exact instruction file, enumerates the omission and checks no AGENTS exists before phases. Full host dependency identities remain checked; only this unused instruction payload is not copied. Final same-slice positive/duplicate controls both pass. No observer rerun.

Across all attempts there are four real production compiler executions: two positive builds and two deliberate duplicate negatives, plus two zero-build setup failures. Each successful positive slice has exactly one driver-managed build. Test-owned isolated builds remain a separate approved scope; no universal-one-total-build assertion is made. Metadata-only sealing failures (the instruction-copy detection and a stale already-removed cleanup path) and their unchanged script versions are recorded in `SEAL-ATTEMPTS.json`; the latter required no control replay.

## Closure, containment and cleanup

`BINDINGS.json` rechecks full37397-entry candidate metadata membership, exact four fixture paths/hunks/blob/SHA256 identities, unchanged source tree, and unchanged candidate/profile/cleanup/external bindings. No fifth fixture, later WHICH77 or Stage2 is introduced. Only4640 authenticated regular candidate files (35,496,154 bytes) plus authenticated existing development dependencies are materialized for this actual typing slice. The full Git index is metadata only, without Git objects/alternates/live source fallback. This is not a claim to have executed the full2.382GB runtime closure.

The actual phase runner keeps its real loader/audit, argv, supervisor and cleanup. A transparent adapter runs only its Node children through the recorded macOS write/network fence; outer process observation is not sandboxed or stubbed. Readable Node/Git/npm/dependency identities are checked before/after. Additional `/usr/bin/sandbox-exec` and `/bin/bash` executable hashes are explicit. `LOAD-PROOF-2.json` independently validates661 recorded child module resolutions,425 unique modules across37 processes, against committed selected files, copied dependency identities, authenticated npm, and frozen guard/audit bytes. Parent load provenance is also retained; full execute/public/worker modules are denied before imports.

The OS qualification remains **only macOS26.4.1/build25E253 and the exact11 sampled unreadable system-library references** enumerated in `BINDINGS.json`. Metadata is not filehash/fullOS attestation; no generalized non-system/npm/user/Homebrew/unknown-injection exception or complete process-image tracing is claimed.

Per-phase supervisor timeout360s, output64MiB, cooperative5s disk sampling, work1GiB and raw128MiB limits are recorded. Final measured work peak183,586,076 bytes; raw final120,819,203 bytes before lossless streaming gzip. The20-minute execution watchdog starts after bounded setup, not a kernel-hard whole-task deadline. All raw JSON/stdout/stderr/resolution traces are retained either verbatim or losslessly compressed with original hashes in `RAW-INDEX.json`.

Final temporary tree has9701 regular files and **zero AGENTS**, is hash-receipted and removed. All staged driver copies and all earlier owned temporary trees are gone.87 recorded process identities have no matching survivors. All56 preexisting independent artifacts match their original hashes. Foreign workspace staging/artifacts are not cleaned or committed.

## Qualified ledger and handoff

`LEDGER.json` preserves initial19PASS/3HOLD and prior21PASS/1HOLD. Current cumulative qualification is **21 inherited PASS + one new scoped A10 PASS**, not22 fresh runs or whole-driver execution. The supplemental observer result is a new cohort; old v5 contained-link EPERM and author b0ee/dfcb failures remain failures in their original records. Original22 assertions, F01 exit1/static10, author56/5, fixture49/1 then19/19, old2ff20/1 and Meitner71PASS/7NOT_EXECUTED are untouched.

The seven new76 proofs remain **six inherited bounded-refusal proofs / complete-binding HOLD**. No valid `--run`, ROOT_RELEASE, full gate, native cohort, private engine, package recreation or runtime consumer suite was launched. Root must bind the required EXPR/public/private prerequisites and release authority to the final packet; this leaf does not reinterpret moving coordinator commits as authorization. Stop here for root handoff.

Exact executed commands and statuses are in `RESULTS.json`: pinned Node24 runs `review.mjs` (1), `review-followup.mjs` (1), `review-followup2.mjs` (0, policy incident), and `review-followup3.mjs` (0, clean qualified proof). `finish-seal.mjs` performs only static validation/compression/owned cleanup, exits0. Earlier sealing errors and sources remain separate. All commits use explicit individual owned paths and `git commit --only`.
