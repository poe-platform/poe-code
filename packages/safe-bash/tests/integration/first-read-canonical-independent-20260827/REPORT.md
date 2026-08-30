# Different-reviewer verdict: accepted, bounded fixture migration

Candidate `073d39c6c49d5ee24172706e02179dd6da484483`, policy freeze
`b891af93b1e710e1910b5dad8f72854c5930da05`, author evidence
`edc6636f4956cf87253e31dc483fa4f5b09a8c26`. Reviewed August 27, 2026.
No product defect was demonstrated and no product or author fixture was edited.
This accepts the specified ownership-aware canonical migration, **not opaque
producer preemption, a product fix, whole-gate acceptance, or historical rescoring**.

## Authentication and isolation

The candidate commit changes exactly the three authorized TypeScript files.
The five lifecycle paths in `CANDIDATE.json` have no freeze-to-candidate delta.
The intervening root/plugin DU ancestry is included, not silently replaced with
the earlier root exports. The independent runner obtains all inputs from Git,
not the working tree: 249 product files plus eight configuration/test inputs.
The compact 257-file archive contains no AGENTS copies or loose source snapshots.

Each execution uses a newly extracted task-owned temporary checkout. Only the
installed tsx/esbuild/platform binary/TypeScript/Node-types/undici-types toolchain
is copied into a separate task-owned tooling directory; there are no installs,
runtime dependency additions, or shared node_modules symlinks. HOME/TMPDIR are
task-owned, ambient NODE_OPTIONS/NODE_PATH are not inherited, and tsx caching is
disabled. An inherited Node load hook rejects file modules outside that root.
A deliberate import of the live repository's source is rejected. The successful
run records 7,194 module-load observations and authenticates **199 actually loaded
product files** against their candidate SHA-256 values. Product hashes remain
identical during all fixture-only negative controls and after restoration.

Environment: Node 22.22.2, Darwin arm64; tsx 4.23.12, esbuild/platform binary
0.28.2, TypeScript 5.9.3, @types/node 22.20.1, undici-types 6.21.0.
Node executable SHA-256:
`5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011`.
The raw records contain every resolved module filename/hash, exact commands,
stdout/stderr, child PIDs, timing, timeout/output/group checks and temporary roots.
This is source execution through an isolated TS loader, not a packed consumer.

## Counts kept separate

| Cohort | Result |
| --- | --- |
| Unchanged candidate canonical supervisor | **10/10**, zero fail/cancel/skip/TODO; all three recorded attempts |
| Additional direct replays with independent journal assertions | **10/10** |
| Fixture/admission/observation negative controls | **12/12 rejected as intended**: ten by candidate assertions/errors, two by independent guards |
| Live-checkout fallback denial | **1/1** |
| Narrow strict types, project `lib: ES2023` profile | **pass** |
| Historical five | **1/5 retained**, not replayed or rescored |
| Historical six including head-zero | **2/6 retained**, not replayed or rescored |
| Curie prior observer archive | **108 files authenticated, 24 observations**, not 24 new executions here |

The sealed final run is `artifacts/final-replay.data.json.gz`; the preceding
complete passing run remains in `artifacts/attempt-02.data.json.gz`. The final
runner moves the no-overwrite check before temporary-root creation and records
its own and the control-definition hashes; the same full bounded scope was
rerun after this harness-only improvement. The initial isolated
canonical also passed 10/10, but the reviewer's first type command omitted
`--lib ES2023`, enabling TypeScript's default DOM library. It failed with TS2353
on WebDAV `RequestInit.duplex`. This is retained verbatim in
`artifacts/review.data.json.gz`; the correction matches the committed project's
ES2023-only lib setting, with explicit isolated typeRoots. It is not a source
fix, suppressed diagnostic, or full-repository type claim. Before test execution,
an initial read-only zsh inspection used reserved variable `path`, causing exit
127; a later optional TAP diagnostic decoder failed on TAP-escaped JSON. Neither
executed product code or changed test outcomes. No failed artifact was overwritten.

## Exact case mapping and observed boundary

| Migrated case | Independent observation / preserved constraint |
| --- | --- |
| head-zero | Same `head -n 0`, exit 0, empty bytes, next 0 / return 1; caller/head live. |
| local unenrolled controlled | Command-signal producer still pending through 1200ms, read 1 / return 0 / active 1. Explicit host gate release then return 1 / active 0, never caller abort. This is an intentional schedule change, not unchanged original input. |
| local owned | Explicit createOutputOperation enrollment; acquisition/release 1/1, read/return 1/1, active 0 before public; operation/destination EPIPE, caller/command live. |
| S3 original | Same `cat /input \| head -n 0; true`, input stream and 13-byte metadata, exit/bytes, read/return 1/1 and active 0. Exact GET operation/destination EPIPE, caller/cat live. Operation identity assertions replace the obsolete whole-command-abort observation; no stream/closure assertion is weakened. |
| DAV original | Preserved original server-start gate, flushed headers and pending body; GET fetch calls/settled/rejected 1/1/1 before public, responses/readers 0/0; GET operation EPIPE and caller/cat live. |
| curl original body-labelled | Preserved flushed-header admission gate; response acquisition/disposal 0/0. Registered transport cleanup completed and actual ClientRequest closed before public; caller/curl live. |
| curl original headers-labelled | Preserved request-with-no-response-headers gate; same request/cleanup counts and zero acquired response. Not counted as a body finalization test. |
| DAV acquired body | New downstream gate waits for actual first reader.read: GET response/reader/read/release 1/1/1/1, pending 0 before public. Exact observed reader cancels 2 and body cancel 1, all rejected EPIPE; no arbitrary cleanup error accepted. |
| curl acquired body | New gate waits for acquired response first body.next: response/read/return/return-done/dispose/dispose-done/request-close each 1; pending 0, registered cleanup done before public. |
| required destinations | Stdout EPIPE does not abort caller/curl/transport. Exact file body `first\nsecond\n`, HTTP 200 / length 13 headers, HTTP 200 verbose stderr survive; response dispose and request cleanup/close complete before public. |

Remote server close is a separate **passive** observation after public settlement
when necessary, always before dispose/fixture teardown. It is not falsely counted
as a pre-public server-side event. All six remote rows end with sockets 0, tasks 0,
server not listening and fixture errors 0. All positive rows have live callers,
no observer/cleanup errors or unhandled rejections, and no supervisor rescue.
The author field `callerAbortedBeforeCleanup` is actually emitted after cleanup;
acceptance does not rely on that misleading name: live-at-public assertions and
the entire signal journal independently rule out a caller-abort rescue.

The supervisor's 3000ms per-child bound, combined 1 MiB cap, strict unhandled
rejections and residual process-group checks are byte-unchanged; its only delta
is the scenario list. The independent outer runner also bounds each launch and
checks residual groups. All recorded runs exited without outer timeout, output
overflow, signal termination or residual groups. All task-owned roots were removed.

## Negative-control scope

The control definitions are in `controls.json`; only extracted **test** files are
mutated, never production or author working-tree files. These are assertion and
admission sensitivity checks, not a product mutation score:

- Late completion observations for transport cleanup and response disposal fail
  at the captured public boundary rather than being accepted after teardown.
- Missing actual reader release and missing iterator-return completion fail.
- Whole-caller-abort rescue fails; both acquired-body rows reject early gates
  which reproduce the original no-acquisition schedule.
- Required body corruption, missing header destination and missing verbose stderr
  each fail separately.
- Deliberately mislabeling the cleanup event as dispose-time and reducing the
  unenrolled observation to 0ms still pass the remaining candidate assertions;
  the independent phase-journal and elapsed-time guards reject those two specific
  weakenings. These are **not** claimed as candidate assertion kills or real
  product lifecycle failures. The elapsed check is a bounded sensitivity witness,
  not an independent scheduling precision guarantee on arbitrary hosts.

No control is credited for a parse error, timeout, arbitrary unrelated rejection,
or killed process. The raw mutation hashes, outputs and expected classifications
are retained. The positive exact Node cancellation counts are environmental
observations, not a cross-Node requirement to issue two reader cancellation calls.

## Replay and artifact verification

From the repository root:

```sh
node tests/integration/first-read-canonical-independent-20260827/verify.mjs
node tests/integration/first-read-canonical-independent-20260827/review.mjs fresh-review-name
```

The first command authenticates compact artifacts against Git without executing
historical probes. The second refuses to overwrite a named result, extracts the
same candidate and repeats only this bounded scope with locally installed tools.
No runtime/source edits, root wiring, current full-gate rescore, or SafeJS host
qualification are implied. The historical 8,670 cohort remains untouched.
