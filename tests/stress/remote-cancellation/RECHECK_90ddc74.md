# Independent original-24 cancellation recheck

August 26, 2026. Leaf scope: `tests/stress/remote-cancellation/**` only.
No delegation, production edits, semantic fixture/helper changes, new runtime
dependencies, external provider requests, curl/network tests, or broad suites.

## Verdict and distinct cohorts

**Pinned `90ddc74`: original 24/24 pass in each of three fresh normal,
nonverbose strict processes; wrapper and audit child both exit 0 every time.**
A separate verbose control also passes 24/24, with both exits 0. Each run has
zero failed, cancelled, skipped or TODO cases, all 24 original names in order,
and 12 aggregate pipelines. The normal cohort is 72 passing case executions;
the separate verbose cohort is 24. No product regression was found here.

| Cohort | Result | Status |
| --- | --- | --- |
| Original `4e26ce0` audit | 20/24 in each of three original runs | Historical evidence untouched, not relabeled |
| Author `3731587` handoff | Reported 22/24 | Author-only cohort |
| Independent `45e516e` handoff | D02/D05 2/2; final supplement 10/10 twice | Preserved, not rerun or merged into current denominator |
| Author `90ddc74` / `adba1ea` | Reported verbose 24/24 x3 and shell 726 including 19 new | Not independently rerun as author suites |
| Pre-fix formatter reproduction | Child exit 0; wrapper exit 1 | Reporting failure, not acceptance |
| Initial new recorder diagnostic | Normal child/wrapper 0; 24/24; recorder exit 1 | Mistyped required module path, preserved separately |
| Final independent normal audit | 24/24 x3; child/wrapper/recorder 0 | Accepted frozen original-24 cohort |
| Final independent verbose control | 24/24 x1; child/wrapper/recorder 0 | Separate corroborating control |

Only the final four-run capture establishes this recheck's acceptance. The
initial recorder used nonexistent `src/fs/s3/s3.ts` as a required manifest
entry; the actual pinned module is `src/fs/s3/filesystem.ts`. It stopped after
one run and wrote immutable `recheck90ddc74-verification.json` with its exact
assertion, raw output and 24/24 results. The new recorder path was corrected;
no frozen expectation, helper, timeout, status or cleanup assertion changed.
Manifest equality now compares sorted path/hash records rather than incidental
load order; every loaded module's revision, blob and SHA-256 is still checked.
Three entirely fresh normal runs and a verbose control followed. The initial
record is not rewritten or counted as accepted final evidence.

## Exact commands

The independent capture command completed with exit 0:

```sh
RECHECK_EVIDENCE=tests/stress/remote-cancellation/recheck90ddc74-confirmed.json node --unhandled-rejections=strict tests/stress/remote-cancellation/recheck90ddc74-verify.mjs
```

The recorder invoked this normal command **three separate times**, not three
repetitions in an already-running test process:

```sh
env -u AUDIT_VERBOSE -u AUDIT_CASE -u NODE_TEST_CONTEXT NODE_OPTIONS='--import=tsx --import=./tests/stress/remote-cancellation/recheck90ddc74-register.mjs' AUDIT_REPEATS=1 node tests/stress/remote-cancellation/run.mjs
```

The single separate verbose control was:

```sh
env -u AUDIT_VERBOSE -u AUDIT_CASE -u NODE_TEST_CONTEXT NODE_OPTIONS='--import=tsx --import=./tests/stress/remote-cancellation/recheck90ddc74-register.mjs' AUDIT_REPEATS=1 AUDIT_VERBOSE=1 node tests/stress/remote-cancellation/run.mjs
```

The unchanged child launch uses:

```sh
node --unhandled-rejections=strict --import tsx --test --test-reporter=tap tests/stress/remote-cancellation/remote-cancellation.test.ts
```

`NODE_OPTIONS` only injects the test-only committed-source loader; no case
selection or semantic override is set. The JSON records exact environment
prefixes, raw stdout/stderr, counts, per-case events, source manifests, observed
PIDs/process groups, deadlines, forced stops and residual checks. Evidence files
are immutable: the recorder refuses an existing path. For another requested
capture, choose a fresh `RECHECK_EVIDENCE` filename within this owned directory.
No more replays are needed for this assignment.

## Source identity and freeze

Product target: `90ddc748f21e2164ea3f20e47f32bbdad6a5b20c`.
`git merge-base --is-ancestor 3731587fa287333ca59c7a81569b367cec66f61d 90ddc74`
succeeds. Formatter target: separate commit
`751c18d5ffaee371f8ba567bafb4c721e9b98988`.

The new Git loader reads committed bytes, resolves relative product imports
against that committed tree, and fails closed instead of falling back to
worktree source. It uses only the already-installed development TypeScript
transpiler. All 99 actually loaded modules (98 product modules plus the WebDAV
HTTP mock) match committed blob/SHA-256 identities, and their manifests are
identical across all four runs. The expected manifest contains 107 available
TypeScript files; the JSON distinguishes availability from actual loading.
The root barrel, aggregate command barrel, shell runtime, S3 adapter, WebDAV
adapter and native HTTP mock are all explicitly required in the loaded set.
The pinned barrel does not import the optional network family.

For `src/shell/runtime.ts`, the pinned Git blob is
`39972a0fb5058c7c375f9ffa8b82dd97e89dcca0`; SHA-256 is
`0d4f6fd7c56702dd585d6838278d5b0184288446f95ee9cf5392acf8ee22e60d`.

Final capture: `2026-08-26T22:58:50.056Z` through
`2026-08-26T22:59:35.434Z`, Node v22.22.2, darwin. Worktree HEAD changed from
`0c1bfe2a47f05874eed2cd35c078c31eb1d17ae9` to
`3b63f98a785b84d78bbc4080ea475ee426b471e2`; neither is substituted for the
pinned runtime target. Ten loaded worktree files differ from the target:

```text
src/commands/filesystem.ts
src/contracts/filesystem.ts
src/fs/memory/index.ts
src/fs/mount/index.ts
src/fs/overlay/index.ts
src/fs/readonly/index.ts
src/fs/real/index.ts
src/fs/s3/filesystem.ts
src/fs/webdav/webdav.ts
src/index.ts
```

Those worktree versions were not executed. No source hash drift occurred
during the final capture, whether loaded or merely available. The initial
recorder diagnostic separately records concurrent worktree drift in
`src/commands/filesystem.ts`; that also was not executed. No source was restored,
checked out, edited or staged by this leaf.

All six original non-runner artifacts match `4e26ce0` before and after; the
runner is separately guarded against its authorized formatter commit. All
historical `3731587` handoff artifacts match `45e516e`, and the final harness and
development transpiler hashes are unchanged across the runs. All five capture
guards pass. Key SHA-256 values:

| Artifact | SHA-256 |
| --- | --- |
| Frozen `remote-cancellation.test.ts` | `fc260b459fd75dae542f896396b75ec115d88e753c34cb618a7fab3b963dcbe8` |
| Frozen `helpers.ts` | `9e76ecf9ba6604fc2c4b94a96cf5b46ffed97de5e7d0c2524e138b4410e17678` |
| Original `evidence.json` | `df56f902a178d57c6fbb8ebe1cb4ca35dc4f4c424dbe24ea3de7cc76dbc50c5a` |
| Fixed `run.mjs` | `4c473f220fbbb348feb0cd3f58d7c034e604e64179640d8db08ce7c79b5de25b` |
| `format.mjs` | `2cf3bc9b4ed9356e8a35a94266623da60fed3a68a54daa8d137723b2e02d7b2c` |
| Pre-fix `formatter-prefixed-failure.json` | `bb567babda0100a7a2240d04488aca1b41ff6e9f342a05c54ea6f6c35dc28cf4` |
| Initial `recheck90ddc74-verification.json` | `c88078527459dc4a2a69ac5ff4cfc686bb1204d8a92f2b129d9c3a67f5b4c2bf` |
| Final `recheck90ddc74-confirmed.json` | `174af62c630a453c6185d0eac4fafe17efe11cbfbd96869e224452cbfd82a5e8` |

The prior `handoff-verify.mjs` all-seven-original-files guard intentionally
rejects the changed runner on future invocations. Its old snapshots remain
historically true. It was not weakened, rerun or edited; the new recorder
explicitly separates semantic/artifact freeze from the authorized formatter.
Original `evidence.json` and `REPORT.md` were never overwritten.

## Per-case results and cleanup

Every row below passes in all three final normal runs and the verbose control.
Full ordered events and independent per-case checks are in the final JSON.

| Case | Preserved outcome / effect |
| --- | --- |
| S01 | Pre-abort: exact caller reason, no transport |
| S02 | Pending metadata: `ECANCELED`, late rejection observed |
| S03 | Cooperative GET: caller reason, signal abort, source returned |
| S04 | Noncooperative GET read: `ECANCELED`, late read/return rejection observed |
| S05 | Late GET response: `ECANCELED`, body destroyed |
| S06 | PUT staging: caller reason, destination KEEP, transport iterator returned |
| S07 | Append staging: `ECANCELED`, producer returned, destination KEEP, no PUT |
| S08 | `head -n 1`: exit 0, exact `first\n`, GET aborted/source returned without caller rescue |
| S09 | Output quota: `ShellLimitError`, `maxOutputBytes`, GET returned |
| S10 | Upload quota: exit 1 / EFBIG, body returned, no publication |
| S11 | `S3RenameError` / `ECANCELED` / copy phase; accepted copy remains, no delete |
| S12 | Streaming PUT: `ECANCELED`, producer returned before release, no publication |
| D01 | Pre-abort: exact caller reason, no HTTP request |
| D02 | Noncooperative metadata: prompt `ECANCELED`, late rejection observed |
| D03 | Native GET: caller reason, stalled socket closed |
| D04 | Injected GET body: `ECANCELED`, body cancelled and reader released |
| D05 | Late response: prompt `ECANCELED`, late body cancelled/unlocked |
| D06 | Native PUT staging: caller reason, socket closed, destination KEEP |
| D07 | Blocked PUT producer: `ECANCELED`, source returned, socket closed, destination KEEP |
| D08 | `head -n 1`: exit 0, exact `first\n`, native GET closes without caller rescue |
| D09 | Output quota: `ShellLimitError`, `maxOutputBytes`, GET socket closes |
| D10 | Upload quota: exit 1 / EFBIG, destination KEEP, no publication |
| D11 | Accepted MOVE: `ECANCELED`, input absent/moved original, no rollback |
| D12 | Pending native metadata: `ECANCELED`, response socket closes, no GET |

The unchanged helper asserts filesystem error codes, `ShellLimitError`
instance/limit, and exact caller-reason object identity at the appropriate
boundaries. String diagnostics are evidence of those executed assertions, not
a replacement for typed/identity checks. The new recorder additionally checks
all settlements, zero operations starting after observed abort or with already
aborted operation signals, no failure/cleanup/rescue events, and exact case
counts/order. S08/D08 do not invoke caller-abort rescue.

Each run's nine native HTTP fixtures assert final sockets=0, tasks=0,
listening=false and errors=0; opened/closed socket counts match. Iterator return,
body cancellation/unlocking, late rejection observation and byte/namespace
effects remain the original assertions, with original 1200ms operation, 2000ms
cleanup and 8000ms per-test limits. The runner retains its 60-second process-group
watchdog; the recorder adds an 85-second wrapper deadline and 8 MiB output cap.
All runs finish without either watchdog, forced kill, output cap, sampling error,
or residual process. The runner's group probe and recorder's sampled owned-PID
checks both finish cleanly. No temporary server or resource is intentionally
left running; the evidence does not claim exhaustive observation of every
short-lived OS process or control over uncooperative remote-host work.

## Formatter-only result and limits

`FORMATTER_FIX.md` and its separate commit document the genuine pre-fix runner
failure at `run.mjs:41`: direct JSON parsing of Node's TAP-escaped message.
The fix decodes the transport layer, preserves raw data, handles mixed JSON/
serialized typed-array event values, and marks malformed formatter data as a
wrapper failure. Focused formatter tests pass 5/5 twice after the fixture-only
native-reporter environment correction; the final diff whitespace check passes.
This is a runner code bug, not a production cancellation defect.

These are public injected S3 mock-transport checks and WebDAV native Fetch
against ephemeral loopback HTTP, plus deliberately injected noncooperative
response fixtures. They are not live S3/WebDAV provider interoperability,
remote rollback, atomicity, snapshot isolation, full-shell support, complete
cancellation closure, superiority evidence or 72 hours of work.

**Still open and assigned to Sagan:** extra `head -n 0` when upstream stalls
before its first nonempty write still requires caller cancellation. This leaf
did not investigate or rerun that extra case. The full shell 726, filesystem
suite, adapter matrix, prior supplement, broad fuzz and curl/network work were
not run. No production remediation or ownership transfer is implied. Root can
synthesize this bounded recheck independently of the separate curl priority.
