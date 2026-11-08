# B2-r7 actual-v1 — STOP during offline installation

## One attempt; no retry or runtime change

ROOT's exact command ran once in session 21583, repo cwd/login:false. Grant
`720bee1710c078eb4c9ee606ae69cb101fe5fc688f5a420d715ddfe4d793f7d1`
was 859 bytes/mode0600. Packet was 6519 bytes, SHA256
`f97901065a7803f72edb92c19f219e66f35dc2f050917d10dd25cb411ba5f65a`.
Source candidate `5d60457781b73783eecdd61e34d33ec7916d891b` is unchanged.
Preexec acceptance `7ad82903e3269de5527c8308c755eb1b132bb58c` and final-slot
`d53b70a6c5f9d40372ccdc79ed14cc7270515620` remain distinct from this actual result.

Last prelaunch admission was **2026-08-29 15:53:06.068 UTC**, inside the
15:52:01.060–15:57:01.060 launch window. Exec yielded after 1000ms; one same-session
poll observed **exit78**. There was no transport timeout, scheduler, retry,
permission expansion, code change or expectation change. Runtime captures were
already direct-to-file through the approved launcher.

## Exact outcomes

| Cohort | Source-built | Installed | Physically moved |
| --- | ---: | --- | --- |
| Redirections | 48/48 | UNRUN | UNRUN |
| Unit2 | 50/50 | UNRUN | UNRUN |
| Conditional | 67/67 | UNRUN | UNRUN |
| Extension | 35/35 | UNRUN | UNRUN |
| Arrays | 12/12 | UNRUN | UNRUN |
| N14 | 12/12 | UNRUN | UNRUN |
| Positive type role | exit0, no diagnostics | UNRUN | UNRUN |
| Negative type role | exit2, exact eight diagnostics | UNRUN | UNRUN |

Thus **224 passed / 448 UNRUN of 672**; two completed type roles / four UNRUN;
eight matched expected diagnostic identities / sixteen UNRUN. Seven mutants,
seven restores and two binding refusals are all UNRUN. There are no new semantic
assertion failures in the completed source layout. This is not a full B2 pass.

The six semantic captures report **251 created/disposed** instances with matched
counts/true disposal and no cleanup error. These are the frozen fixture assertions,
not arbitrary-provider quiescence. Original raw case fields/statuses are preserved.

## Failure and retirement

The ninth role, `offline-install`, was interrupted by the owner. Its periodic live
work census called `lstat` after a cache pathname disappeared:

```text
ENOENT: no such file or directory, lstat '/private/tmp/safe-bash-b2-runtime-r7/cache/_cacache/tmp/E83Yqx/dist/commands/regex-execution/client.js'
```

The exact path is an npm temporary extraction pathname, not proof of an ERE
execution defect. `support.mjs:40–41` performs readdir followed by lstat over the
live mutable tree; `owner.mjs:78` invokes this observation every 50ms. Its
`work-census` failure is retained as primary, then SIGTERM is sent to the install
process. The secondary child-outcome failure follows; it does not replace primary.
This is an administrative live-census race, not evidence that a logical cap was
exceeded or that installation succeeded. No proposed repair is implemented here.

Nine supervised children have one exit and one close each, with `unknown:false`:
seven exit0, negative compiler exit2, install PID40912 exit/close SIGTERM. One
SIGTERM was recorded; no SIGKILL. The owner is observed by the exec tool as exit78;
that is not a separately recorded owner exit/close event pair or group-absence
proof. DATA preservation helper PID45220 exited/closed0 with empty stderr.

Original primary stack/path bytes survive in both outer capture and
PARTIAL-FAILURE.json. Runtime secondary object summaries remain `{type:"object"}`;
their full raw references cannot be reconstructed from serialization. The explicit
`secondaryPresent:false` is the terminal abort-close field, not a statement that
the earlier child-outcome failure never occurred.

## Trace, capture and identity

Six functional async-loader admissions occurred; all six hosting processes
exited/closed0. Individual loader exits/native helper threads are UNOBSERVED.
There are 1495 prepared-source records across six traces (250,249,249,249,249,249),
420326 trace bytes. The prepared-source records precede source return and alone
do not prove evaluation. Exact source case outputs provide the separate execution
evidence. Every record's member/hash matches its bound per-role source inventory;
all six post-retirement verification hashes/bytes/records match preserved traces.

Zero Regex is the inherited static-closure expectation, not a fresh instrumented
Worker census. No guest engine was in the authorized or observed role graph.
Native helper-thread totals and universal transitive census are not claimed.

All child raw bytes were retained: **105843 attempted / 105843 stored**, plus
1689 outer bytes. Raw publication copies contain 1386401 bytes including trace
metadata, bindings, event records and task-owned npm logs. RAW-MANIFEST.json SHA256:
`6a0f04603f3322377c6150c46e55e7e0d145cb0e087bffad51da7fe8bf4d1f6c`.
DATA audit RESULT.json SHA256:
`e4b524853efeee09fbf5f316284386c57cd0dc7b2a101322573b350c43eb7d67`.
That RESULT is explicitly a **STOP audit**, not a fabricated successful runtime
RESULT. The runtime produced only PARTIAL-FAILURE.json.

Fresh postguards checked all 31 packet members and the source-built package's
1014 files, including bytes/hashes/modes and no extra entries. Frozen product
package remains SHA256
`2fe071e2bfac5ef5c81dc7e475e059091f6add65cd7411dfcfbf0ce7f51f2eca`.
No mutations had been admitted. A retired-work snapshot including duplicate raw
publication copies measured 13499629 logical bytes. Git internal physical storage
is not included. Runtime and partial install/cache are retained, not deleted.

The reported 79169.266125ms elapsed is anchored from notBefore, including time
before actual launch; it is **not measured runtime wall duration**. All publication
remains bounded by the original 16:22:01.060 UTC expiry, no renewal. Historical
r6 43a1c3dc 0/672 FSYNC failure, scheduler timeout and EEXIST remain immutable.

## Required next decision

This consumes r7 GO. A separate source repair/review decision is needed for
observing explicitly mutable installer scratch paths without treating a normal
disappearance as a frozen-input integrity violation. Any future proposal must
retain hard accounting and fail-closed guards on immutable inputs; this handoff
does not authorize a blanket ENOENT swallow, new cap, retry or relaxed assertions.
