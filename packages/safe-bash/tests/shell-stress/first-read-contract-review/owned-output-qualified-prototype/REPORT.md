# Qualified TEMP output operation: author evidence

## Scope and conclusion

**S2 source equals authenticated S1. Zero source-fix rounds; no new helper or lifecycle API.** The refinement is a Proposed operation contract, exact type/profile handoff and bounded copied-candidate evidence. Live Implemented Through is **Not applicable**. No production/API/root-config/source edits, dependency installation, rootdist build, current full-suite/release qualification or superiority claim occurred.

Four frozen logical controls, eight curl profiles and twelve distinct precedence parameters were used. Original/current/candidate/native curl cohorts each contain eight records; they are not32 new cases. No aggregate all-PASS claim is made: original precedence remains9/12, and missing baseline nested returns remain unavailable, not equal by assertion. Supplementary selected-rejection bindings reuse three existing parameters and are explicitly separate.

## Authentication and baseline drift

`baseline-snapshot.json` authenticates restored read-only S1, all358 recorded compiler inputs and existing tool/restore identities. `build-identities.json` authenticates copied builds and source/test stability. Exact source IDs:

| Profile | Source manifest SHA256 | Qualification |
| --- | --- | --- |
| Original pre-operation | `6d8589043618e623e35a63e92cbecc160b7f587335a69bba3e0b0f57e34dca8b` | Original archive based on c9b96263d1204bdf54e89324cc0c7d1ef6bd3f79 |
| Captured current | `dd251c3dfee7861ec1beae5a70302f931fa3a5c1ea9964aea4f2a4e6a6e8f7f8` | Time-qualified source/config capture, not current release freeze |
| S1 / proposed S2 | `6de9b96c7286cc320379d8f7f720f3d1a5ecffdc24b7268b198859550362feea` | Identical restored source; historical source patch c5e2d338 |

Current capture interval: **2026-08-27T12:13:59.628Z–12:14:00.623Z**. Before/after source/config reads match combined manifest `cbdddeb2d6b319c688c38573e89b334dd5fab66f11403f8469e543dfd92f54b9`. Observed dirty HEAD was `e0aa2d2314de815dcf2773889c5a46ae2d04ed8e`; earlier coordination HEADs are not this capture. The current curl/transport/runtime/cleanup/public-command contract equal original pre-operation bytes, while broader source/config differ. Both exact baselines are archived; neither silently substitutes for the other.

S1 tests remain `dd1814102e91c030d9cb1723bbaf69c3bf467ecd404e89dcb07cc315e5f5e35c`; compiled output remains `2578b6ea39cfdeb5b942b9aff20ec9bfff1fcf907cd2af751d8e73f5c24e632f`. Candidate build plus copied source/test typecheck pass; original/current copied source builds/typechecks pass with342/343 actual compiler inputs, respectively. Those baseline source checks are not complete-current-test qualification. New typed public-declaration consumer and compiled-API runtime import pass.

## Q01: curl, exact effects and profile separation

`results-curl.json` retains all32 raw records: hex stdout/stderr, status, nested return when available, write attempts, stage/caller signals, VFS/native file bytes or typed errors, request headers/body, closure order and zero-socket/task cleanup. `evaluation.json` applies the pre-run public-status/effect criteria; its evaluator was authored after raw execution and is not presented as an independently pre-frozen native oracle.

| Profile | Original/current public status | S1 public / nested | Native public / PIPESTATUS | S1 stdout attempts |
| --- | --- | --- | --- | --- |
| C01 mixed files/writeout, drain | 0 | 0 / 0 | 0 / 0,0 | 1 |
| C02 mixed files/writeout, closed/default | 0 | 0 / 141 | 0 / 0,0 | 0 |
| C03 same, pipefail | 141 | 141 / 141 | 0 / 0,0 | 0 |
| C04 header file/body+writeout stdout, closed/default | 0 | 0 / 141 | 0 / 23,0 | 0 |
| C05 same, pipefail | 141 | 141 / 141 | 23 / 23,0 | 0 |
| C06 required files, no writeout, closed/pipefail | 0 | 0 / 0 | 0 / 0,0 | 0 |
| C07 genuine writeout failure | 23 | 23 / 23 | 0 / 0,0 | 1 |
| C08 genuine body-file error, positive writeout | 23 | 23 / 23 | 23 / 23,0 | 1 |

**8/8 scoped public-status/stdout and required-effect checks pass.** Both baselines have identical exact public stdout/stderr/status and VFS effects across their eight profiles. S1 preserves those public statuses/stdout, but intentionally retains independent parent stderr/file work which the original/current early-pipe cancellation prevents in C02–C05. This is not byte-for-byte equality of all behavior. Baseline nested curl returns are absent in those four records because the pipeline abort wins; this product exposes no public PIPESTATUS vector. Native vectors are actual Bash captures. Missing product vectors/nested returns are a measurement limitation, not fabricated equivalents. The frozen broad nested-baseline comparison is therefore not fully bound.

C01 emits exactly `W:200\n`, proving the writeout path exists. C02–C05 establish request start, consumer closure, then server first response write; S1 makes zero stdout write attempts, returns nested141 and preserves the required effects. C06 is the distinct no-writeout success0 control. C07 retains exact product stderr `curl: (23) Failed writing write-out result\n` and status23, despite complete body/header files. C08 retains23, exact `Failed writing virtual output file` diagnostic, EISDIR and positive `W:200\n`. These controls distinguish deliberate no-attempt closure from accidentally missing writeout and from a genuine output failure.

Required body is exactly14 bytes `required-body\n`; header files are identical125-byte fixed HTTP headers including CRLF, Content-Length14, fixed Date, X-Qualified and Connection:close. Independent file is exactly `independent-file\n`; independent stderr is exactly `independent-stderr\n`. Native independent effects are emitted by the post-pipeline Bash harness; S1 effects are performed by the still-live parent plugin after nested curl. These ownership locations are deliberately reported, not treated as identical native command internals.

The barrier waits for request-start, not upstream read demand. Native helper closes fd0 before acknowledging closure to the loopback server. S1 capability closure is observed before response publication. Original/current lack that capability; their reader returns before the server's next-turn release, and attempted writes expose the closed pipe. Stage state at final observation is separate: old normal pipeline finalization aborts controllers even after successful completion; this must not be mislabeled as a prior consumer-caused failure.

## Native/tool and external-document qualification

Actual `/usr/bin/curl -q --version`: curl8.7.1, x86_64-apple-darwin25.0 build string, libcurl8.7.1, SecureTransport, LibreSSL3.3.6, zlib1.2.12, nghttp2/1.68.0. Binary SHA256 `5ef748580e05e8208c8faacc9be88d1aa48d9970101c0a29ba26896e017e6226`. Host uname is Darwin25.4.0/arm64; do not infer a different library/architecture profile from the build string. Bash3.2.57(1)-release arm64-apple-darwin25 SHA256 `35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3`. Node/helper engine v22.22.2 SHA256 `5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011`. Helper source hash is in `freeze-r0.json`.

`freeze-r0.json` captures actual version output and otool dependencies: curl links libcurl.4/libz.1/libSystem.B; Bash links libncurses.5.4/libSystem.B, with reported compatibility/current versions. System dyld shared-cache library bytes are **not separately authenticated**, so the pin is binary plus observed runtime/version/linker metadata, not a claim of fully frozen operating-system libraries.

Native invocations use `-q` first, explicit `--noproxy '*' --proxy ''`, loopback IP/port, bounded transfer/connect timeouts and an allowlisted environment without proxy/credential/config variables. No native tool was downloaded or installed. C07 native intentionally closes stdout descriptor (EBADF); product injects an EIO sink without consumer closure. Their genuine-error profiles are not errno-equivalent. Native writeout-only failure returns0 here, while body-pipe failure returns23; product141/23 distinctions remain unchanged.

Primary external source, retrieved using web.run on **2026-08-27**: https://curl.se/docs/manpage.html (also search result https://curl.se/docs/manpage.html?category=23). Sections `--disable`, `--write-out`, and exit23 explain first-argument config disabling, final writeout and local output errors. The current manual says writeout failure does not change exit status. This is present-day documentation, **not an authenticated curl8.7.1 manual**; actual local runtime/version output and observations above are primary for the native profile. No universal POSIX/GNU/BSD equivalence is asserted.

## Q02: exact precedence without a competing API

The unchanged invocation contract selects caller abort exact reason, then an actually selected execution rejection, then cleanup failure. `consumer.mts.data` demonstrates the owned-code pattern: separate failed/value slots for execution and cleanup; await close; rethrow primary if present, otherwise cleanup failure. The same registered idempotent close promise retains secondary cleanup failure for invocation drain. No blanket finally-masks-primary or unconditional cleanup-to-success pattern is endorsed.

Original raw precedence: **9/12 pass**. P01/P02/P03/P04/P12 exercise caller0/Error/default reasons with local identities separately preserved. P04's normally closed operation remains un-aborted while public caller0 wins. P12's native `abort(undefined)` produces the actual default AbortError, not literalundefined. Literalundefined execution/cleanup throws are independently represented, not omitted JSON fields. P08/P09/P10 cover cleanup-only0/undefined/Error; P11 normal success. P02's post-caller local throw is fixture-owned host code, not a claim that an already-aborted operation permits a fresh write.

P05/P06/P07 original public-identity assertions fail: ordinary registry throws0/undefined/Error are converted into command status1; the public selected outcome is then cleanup Error/Error/0. Local IO identities and cleanup counts are correct. This is an invalid public-rejection binding assumption, **not an operation source defect or new precedence policy**. Those failures remain raw and do not become passes by reinterpretation.

`SELECTED-BINDING-PRE-RUN.md` freezes a separate actual outer host-sink rejection for the same three parameters. After the command's status conversion, the syntax-diagnostic host sink explicitly throws the same value; this genuinely selected execution rejection wins over recorded cleanup. Corrected supplementary result: **3/3**, separately reported; never relabeled unchanged12/12. Its initial0/3 failed selector is retained. No source/parser change occurred.

## Q03/Q04 and separate historical cohorts

Q03 passes explicit independent child close, parent admission refusal, shared close promise and cooperative sibling drain. Q04 passes borrowed owner live at operation close (zero returns), stage live, independent sibling/file/stderr work, then exactly one legitimate top-level owner return. No cursor conservation, universal handback or opaque-preemption claim follows.

Unchanged S1 author streaming/reused-buffer suite: **6/6**. Separately replayed old57: remote19 + byte-IO28 + shared5 + streaming4 + head-zero1 = **57/57**. Old controls **9/9** remain historical (synthetic C9 is not product proof). Original-five **1/5**, opt-in-five **5/5**, unchanged. Original local/WebDAV/curl-body/curl-headers deadline failures remain raw and all their subprocesses are reaped. Old12 logical10PASS/2BLOCKED and20parameters17PASS/3BLOCKED, earlier9/8/3 and rejected-v2=3/7 remain untouched historical evidence, not this cohort.

## Failures, closure, limits and handoff

`FIXTURE-CORRECTION.md` separates two main fixture corrections (NetworkAuthorization shape; actual socket-close awaiting), one supplementary diagnostic-selector correction and **zero source-fix rounds**. All earlier raw outputs/executable captures survive. One read-only summary command had a JavaScript extra-parenthesis syntax error and was corrected; it did not execute fixtures or alter candidate bytes. The initial handoff briefly named the inline capability type; before source edits/freeze it was corrected to the actual anonymous declaration, with no source/API change.

Final curl records report zero sockets/tasks and closed servers. Native Bash groups and all historical/consumer subprocesses exit and are reaped; no hard supervisor kill, SIGSTOP, poller or remaining opaque fixture is reported. The initial denied-request fixture timeout is preserved separately, not hidden. Strict unhandled-rejection mode is used. Historical tsx children receive explicit task TMP/TMPDIR/TEMP and `TSX_DISABLE_CACHE=1`; no ambient-cache or syscall-wide audit is implied.

`SOURCE-PROFILE.json` seals read-only candidate and exact source/test/compiled/API/contract hashes. `reconstruction-proof.json` verifies940 candidate files,931 original baseline files and925 current-capture files from inert archives, without source fallback or live build. The source-profile/API/contract identities are repeated in immutable task `final-result.txt` after the owned commit. Root must observe actual author exit before fresh independent execution; the author writes **no ready marker**. Actual recorded work is a bounded interval starting12:13:59Z, not a72-hour claim.

**SafeJS privileged facade/guest membrane audit: NOT AUDITED.** Audit ownedOutput/consumerClosed/accounted-write/cleanup hooks before promotion. Metadata safety is not assumed. No live SafeJS edit, universal closure, release qualification or production permission is implied.
