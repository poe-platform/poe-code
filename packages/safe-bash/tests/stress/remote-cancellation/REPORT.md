# Independent remote transport cancellation audit — NOT PASS

Date: August 26, 2026. Ownership is exclusively this new directory. No adapter,
shell, command, existing fixture/test, project rule, configuration, or shared
documentation was edited. This is an audit with frozen failing regressions,
not permission to fix source.

## Verdict and exact denominator

- **24 cases: 20 PASS, 4 FAIL, 0 skipped, 0 cancelled**, identically in three
  fresh-process `--unhandled-rejections=strict` replays: **72 executions,
  60 passes, 12 failures**. Failed rows remain required assertions.
- **Two genuine pipeline cancellation/cleanup failures:** S08 and D08.
  A completed downstream `head` leaves upstream GET waiting and unclosed.
- **Two separately classified injected-transport robustness gaps:** D02 and
  D05. WebDAV does not stop awaiting a fetch implementation that ignores its
  signal. Such an injection violates the documented WebDAV fetch precondition;
  these are not claims of a conforming native Fetch protocol failure.
- Twelve aggregate-plugin pipeline invocations per replay; ten actually enter
  commands and remote transports, while two correctly reject before execution
  because their signals are already aborted. Pipelines use the real public
  `Shell` plus unmodified `agentCommands()`, not replacement command handlers.
- Twelve S3 cases use instrumented public transport wrappers around the actual
  `MockS3Client`; nine WebDAV cases use native Fetch and an ephemeral loopback
  HTTP server; three WebDAV cases use injected fetch/WHATWG response bodies.
  Eight of the nine HTTP cases send requests; the pre-abort case sends none.
- Scoped TypeScript checking passes. No broad `npm test`, unscoped test runner,
  runtime dependency install, production network, or credentials were used.

The machine-readable `evidence.json` contains every replay's ordered events,
durations, commands, exit codes, source hashes, and foreign status snapshots.
No denominator reduction or dialect exception was applied.

## Reproduction and validation

Run from the project root:

```sh
node_modules/.bin/tsc --noEmit -p tests/stress/remote-cancellation/tsconfig.json
node tests/stress/remote-cancellation/run.mjs
AUDIT_REPEATS=3 AUDIT_VERBOSE=1 node tests/stress/remote-cancellation/run.mjs
AUDIT_CASE='^(S08|D08) ' node tests/stress/remote-cancellation/run.mjs
AUDIT_CASE='^(D02|D05) ' node tests/stress/remote-cancellation/run.mjs
node tests/stress/remote-cancellation/capture.mjs
```

The first command exits 0. The full audit, strict repeats, and each failing-pair
reproducer exit 1 on the checked revision. `capture.mjs` runs the scoped check
and three strict full replays, then adds/updates only this directory's
`evidence.json` through `apply_patch`; it intentionally exits 1 for this verdict.
The filtered commands are minimal diagnosis commands, not acceptance runs.

Recorded final capture: **2026-08-26T22:10:23.615Z through
2026-08-26T22:10:45.230Z**. Replay durations were 5832.308333, 5502.821375,
and 5504.37875 ms, each with 24/20/4 tests/pass/fail. Each child uses:

```sh
node --unhandled-rejections=strict --import tsx --test --test-reporter=tap tests/stress/remote-cancellation/remote-cancellation.test.ts
```

Environment: Node v22.22.2, darwin. The scoped tsconfig includes only the new
audit TypeScript files; their normal imported source dependency graph is checked,
not the repository's other test suites. This is not a whole-repository pass or
a measurement of the user's requested 72 hours of work.

## Cases: expectations and observed effects

All settlement/cleanup gates have a 1200 ms bound; each test has an 8000 ms
outer limit. Times below are complete-case min–max milliseconds across three
replays, including fixture cleanup, **not transport performance benchmarks**.
`ECANCELED` is asserted on filesystem errors. `cancel` in shell rows means
rejection with the caller's `Error: audit cancellation`, not a serialized errno
assertion. Upload quota rows assert shell exit 1 and meaningful EFBIG diagnostics.
Output quota rows reject with `ShellLimitError: ... maxOutputBytes`.

`ops` counts adapter calls at the injected public transport boundary, excluding
fixture seeding and raw mock state inspection. No observed adapter operation
starts after caller abort or with an already-aborted operation signal.
`A/N/R` means source iterator acquisition/next/return counts. A return request is
not a claim that a deliberately noncooperative host iterator has finished.

| Case | Operation / expected result | Actual settlement and cleanup | ops | Byte/publication state | Verdict; ms |
| --- | --- | --- | ---: | --- | --- |
| S01 | Pre-aborted `cat /input \| cat`; no transport | cancel; no body acquired | 0 | Unchanged | PASS; 8–17 |
| S02 | Pending HEAD; prompt cancellation and observed late rejection | ECANCELED before gate release; exact caller signal supplied; late rejection observed | 2 | Unchanged | PASS; 3–4 |
| S03 | Aggregate GET-body abort; close cooperative body | cancel; A/N/R=1/2/1; GET signal aborted | 5 | Read-only | PASS; 15–29 |
| S04 | Pending noncooperative GET next/return; stop waiting | ECANCELED; A/N/R=1/2/1 before late next/return rejections; both observed | 5 | Read-only | PASS; 3–5 |
| S05 | Pending GET response; release eventual body | ECANCELED before response release; late body destroy invoked once | 5 | Read-only | PASS; 1–2 |
| S06 | `cat \| sort -o /output`; abort staged PUT | cancel before transport gate release; transport body acquire/next/return=1/1/1; transport-owned return occurs after gate release | 5 | Existing `KEEP` preserved; no publication | PASS; 6–8 |
| S07 | Append staging with pending producer; no PUT | ECANCELED; A/N/R=1/2/1; zero PUT calls; late cleanup rejection observed | 5 | Existing `KEEP` preserved | PASS; 2–4 |
| S08 | `cat /input \| head -n 1`; successful early close | **1200 ms deadline** despite `first\n` output and completed head; GET signal still live, source return=0 before rescue; caller rescue then returns iterator | 5 | Read-only | **FAIL; 1204–1205** |
| S09 | Aggregate shell output quota; close GET | ShellLimitError; A/N/R=1/1/1; GET signal aborted | 5 | Read-only | PASS; 6–8 |
| S10 | Aggregate streaming upload quota; close body | Exit 1/EFBIG; transport body acquire/next/return=1/1/1, next rejects EFBIG | 5 | Existing `KEEP` preserved; mock never publishes staged bytes | PASS; 6–7 |
| S11 | Abort after accepted rename COPY; honest partial effect | S3RenameError/ECANCELED, phase=copy, copiedKeys=[], deletedKeys=[]; zero DELETE | 9 | Original source and accepted destination both remain; no rollback required | PASS; 2–3 |
| S12 | Streaming MockS3 PUT with pending producer | ECANCELED; A/N/R=1/2/1; transport body return=1 before fixture releases source | 5 | Existing `KEEP` preserved; mock staging unpublished | PASS; 2–3 |
| D01 | Native HTTP pre-aborted aggregate pipeline | cancel; no HTTP request/socket | 0 | Unchanged | PASS; 10–11 |
| D02 | Noncooperative injected PROPFIND; bounded wait robustness | **1200 ms deadline**; only after fixture rejects pending fetch does ECANCELED settle; no response/body existed | 1 | Unchanged | **FAIL; 1202–1203** |
| D03 | Native HTTP aggregate GET-body abort | cancel after downstream receives bytes; unfinished GET response closes before teardown | 2 | Read-only | PASS; 43–64 |
| D04 | Injected pending GET pull and late-rejecting cancel | ECANCELED; body.cancel=1; reader lock released before pull/cancel late rejections, both observed | 2 | Read-only | PASS; 4–16 |
| D05 | Noncooperative injected pending GET response | **1200 ms deadline**; after fixture response release, ECANCELED, body cancel=1 and unlocked | 2 | Read-only; no new request | **FAIL; 1204–1206** |
| D06 | Native HTTP `cat \| sort -o /output`; abort staged PUT | cancel after server has staged whole request but withheld publication; response closes before teardown | 2 | Existing `KEEP` preserved by explicit unpublished server staging | PASS; 12–29 |
| D07 | Native HTTP PUT with blocked producer | ECANCELED; A/N/R=1/2/1 before fixture release; bytes reached server; response closes before teardown | 2 | Existing `KEEP` preserved; server has not published | PASS; 10–11 |
| D08 | Native HTTP `cat /input \| head -n 1`; early close | **1200 ms deadline** after head emits `first\n` and completes; GET remains open; rescue caller abort closes it before fixture teardown | 2 | Read-only | **FAIL; 1210–1221** |
| D09 | Native HTTP aggregate output quota | ShellLimitError; unfinished GET response closes before teardown | 2 | Read-only | PASS; 21–30 |
| D10 | Native HTTP aggregate upload quota | Exit 1/EFBIG; PUT fetch attempted but quota prevents PUT reaching server; only PROPFIND observed on wire | 2 | Existing `KEEP` preserved | PASS; 8–13 |
| D11 | Native HTTP MOVE accepted, response withheld, then abort | ECANCELED; accepted 201 effect retained; response closes before teardown | 3 | Source absent, destination exact original bytes; no rollback required | PASS; 10–18 |
| D12 | Native HTTP pending PROPFIND headers; abort | ECANCELED; unfinished response socket closes before teardown; no GET follows | 1 | Unchanged | PASS; 3–6 |

Fixtures seed `/input` with the exact bytes `first\nsecond\n` and `/output` with
`KEEP`. Preservation checks use byte-array equality, not only length/status.
S3 state inspection calls the raw mock, not an adapter with a cleared signal.
WebDAV state inspection reads the isolated server's mock backing state.
Read-only rows make no mutation calls; they do not infer rollback promises.

## Immediate source handoff: root / Poincare

### RC-1 — genuine downstream early-exit cancellation gap (S08, D08)

Minimal command: `AUDIT_CASE='^(S08|D08) ' node tests/stress/remote-cancellation/run.mjs`.

The public middleware records `command.settled:head`, and the actual stdout sink
receives exactly `first\n`. Nevertheless, upstream `cat` is blocked on its next
remote body read. At the 1200 ms deadline:

- S3 records `signalAborted=false:returned=0:headSettled=true`.
- Native HTTP WebDAV records `GETclosed=false:headSettled=true`.

Both rows stay FAIL. The harness then explicitly aborts the caller to recover:
the S3 body return is observed **before releasing the fixture's pending pull**,
and the HTTP GET closes **before server teardown**. Those recovery events must
not be mistaken for successful downstream-induced cleanup.

Affected coordination path: `src/shell/runtime.ts:289` aborts the completed
consumer's incoming pipe, but `src/shell/runtime.ts:271` aborts an upstream command
controller only when that command attempts another write and sees EPIPE.
`src/shell/runtime.ts:295` awaits every task before the final controller aborts.
An upstream command waiting for a remote read may never attempt another write.
The observed wait sites are `src/fs/s3/filesystem.ts:789` (`iterator.next()`) and
`src/fs/webdav/webdav.ts:260` (`reader.read()`). The remote adapters do respond
correctly when explicitly canceled in the paired control cases.

Route coordination to the shell owner (Sagan) through root, with Poincare
reviewing transport cleanup. The read-wrapper/command paths are
`src/commands/internal.ts:133` and `src/commands/streams.ts`; no command change is
proposed or authorized by this audit. Fixing only one adapter would not explain
the cross-adapter pipeline evidence. Source and expectations were not changed.

### RC-2 — bounded waiting depends on WebDAV fetch cooperation (D02, D05)

Minimal command: `AUDIT_CASE='^(D02|D05) ' node tests/stress/remote-cancellation/run.mjs`.

`src/fs/webdav/webdav.ts:199` directly awaits the injected transport's promise.
The supplied signal is aborted, but these injected promises deliberately ignore
it. Metadata and GET-response waits therefore exceed 1200 ms. After the fixture
settles them, errors become ECANCELED; a late GET body is canceled and unlocked.
There is **no observed late-body leak after response delivery**, and no extra
operation starts after abort. S3's analogous public transport waits settle
promptly (S02/S05); native Fetch WebDAV metadata cancellation also passes (D12).

The README explicitly requires an injected fetch to honor abort signals and
states arbitrary trusted transport work cannot be forcibly stopped. Thus these
red rows preserve the requested stronger bounded-wait audit target, but are
**outside the current WebDAV transport precondition**, not proof of a violated
documented native-Fetch guarantee. Stopping a caller's wait and interrupting an
uncooperative host are distinct; only the former is requested by these rows.
Poincare/root should decide whether to strengthen that boundary in a separately
authorized source assignment. Do not silently turn these rows green or classify
them as remote provider certification failures.

## Cleanup, watchdogs, and protocol limits

- Controllable acquisition/read/staging/publication gates establish ordering;
  no sleep is used to simulate network progress. One event-loop turn permits
  already-triggered late-rejection handling. Timers are deadlines, not gates.
- All nine HTTP fixtures per replay finish with
  `sockets=0:tasks=0:listening=false:errors=0` (**27 clean HTTP fixtures** across
  strict repeats). Socket `close` promises are awaited, rather than assuming a
  `server.close` callback implies that all socket-close events have fired.
- Test assertion failures are preserved while `finally` cleanup continues.
  Pending controlled promises are settled, rejecting cleanup promises are
  observed, shell instances disposed, connections destroyed, listeners closed,
  and deadline timers cleared. There are no owned temporary directories to leak.
- A 60-second process-group watchdog bounds each replay; **zero watchdog fires,
  zero residual process groups, zero strict unhandled-rejection crashes**, and
  zero node:test cancellations were recorded. The runner kills the process group
  on outer timeout, rather than orphaning a test worker/server process.
- No post-observed-caller-abort transport starts were found. There are two
  **pre-rescue cleanup failures** in the head rows, not a claim of leak-free
  product behavior. Fixture rescue leaves no observed server/iterator leak.
- S3 is injected functional transport verification, not AWS wire/signing,
  SDK, multipart upload, credential, ETag-incarnation, or provider certification.
  One PUT wrapper deliberately stages a chunk and ignores cancellation until
  released; its host-side iterator return after release is not falsely credited
  as forced adapter interruption. The actual mock streaming PUT control is S12.
- WebDAV HTTP exercises native Fetch sockets, streaming request/response bodies,
  real HTTP methods and aborts. MockDav supplies DAV metadata and namespace
  effects behind the server. There is no TLS/auth/proxy/HTTP2, deployed provider,
  multipart 207 transfer failure, or provider durability certification here.
  Native Fetch's private reader locks are not inspected or claimed released;
  observable response/socket closure is asserted, and D04 separately checks a
  public WHATWG response reader lock.
- Staged-write preservation is asserted only where the fixture has not begun
  publication. Already accepted S3 COPY and WebDAV MOVE effects remain. The audit
  does not demand transactional rename, undo accepted PUT/MOVE/COPY effects, or
  infer generic provider atomicity from mock staging behavior.
- These cases cover in-flight remote transport work missing from a blocked-pipe
  matrix; they do not replace or alter that matrix. They do not establish full
  shell support, product completion, superiority to just-bash, or 72 hours worked.

## Revisions, hashes, and concurrent work

Initial repository inspection was at
`fa6c095ac8137e853337d78456b0118bdeac48d6`. The final recorded replay window began
and ended at `b797f43bb28eae609f5ff7f079ba636187240f13`.
**No file-content hash drift occurred during the final capture**, including
all source files, audited mocks, relevant configuration/readmes, and owned
test/harness code. The before/after git identities therefore do not substitute
for exact source-byte evidence. `evidence.json.before.hashes` is the full SHA-256
manifest; representative failure-path hashes are:

| Source | SHA-256 |
| --- | --- |
| `src/shell/runtime.ts` | `538a52971da077c87f5dbaba2c5ffd5c972d434064ace412ba101aa70afdcb5a` |
| `src/contracts/io.ts` | `e925ab08a5ad41862d3f5c031164cc7310bc28397455b11b37b75b55a9dbacdb` |
| `src/fs/s3/filesystem.ts` | `4fa05c3868c16ac9c2c309f760b46aa0fc9f211674a5dc3b179992f3e9eaf34f` |
| `src/fs/s3/mock.ts` | `d2356f3917fed36524bf1d944b67af70e3f19b0956064b306e8680b974bf8b6d` |
| `src/fs/webdav/webdav.ts` | `e457d338c395b5870de58f8291e607be997b4e3043d4b0425aa75302315fc4d8` |
| `tests/fs/webdav/mock.ts` | `f46b18da28ed03b8096dc2b8a10fc0aba768947b9af5ebf0ebae602b289d8ce0` |

An earlier three-replay capture (22:06:38–22:07:05 UTC, also 20/24 passing each)
saw HEAD move from `7822b5f1324887fc2504f99f1361c42d9dc16e00` to
`efa56b3adbb6f0f78bde0050c11fbad6dae32672`. Its foreign dirty state included
`src/commands/diff-patch/patch-gnu-paths.ts` and a new foreign
`tests/commands/diff-patch/patch-candidate-errors-followup.test.ts`; those became
committed without source-byte drift in that window. Foreign untracked
benchmark reports, `docs/upstream-patches/safejs/**`, SafeJS probes, and native
diff/search fixture directories remained untouched. Full exact paths are in
the final evidence's before/after status arrays. The final replay followed
stronger owned assertions for exact shell abort-reason identity and the
specific `ShellLimitError.limit === "maxOutputBytes"` quota, without source
edits by this audit. At that final capture, foreign tracked modifications in
`src/commands/diff-patch/patch-gnu-paths.ts` and
`src/commands/diff-patch/patch.ts` were present; their exact source bytes are
included in the unchanged-in-window manifest, not assumed to match HEAD.

Earlier development observations are not final acceptance evidence:

1. Initial scoped `tsc` reported foreign `patch.ts:195` TS1107 plus an owned
   test type import using an unexported root symbol. The owned import was fixed;
   the foreign author independently corrected the invalid `continue`. The first
   runner invocation could not load the aggregate plugin (esbuild transform
   failure), so no case denominator was claimed for that invocation.
2. The first executable 22-case run reported 12 pass/10 fail. A harness-only
   socket-event race masked HTTP outcomes: server close callbacks ran before all
   socket close events. Explicit socket-close promises fixed fixture teardown,
   preserving all original behavior assertions. The next 22-case run was
   18 pass/4 fail. Two added controls brought the final denominator to 24.
3. Foreign generated `.js` siblings were briefly visible. A local
   `node --import tsx --input-type=module` resolver probe selected `.ts` for root,
   shell runtime, contract I/O, and diff-patch imports; none of those foreign
   files was changed or staged by this audit. They were absent at final capture.

Only explicit new owned artifact paths are staged and committed. The report and
failing regressions are intentionally delivered together despite NOT PASS.
