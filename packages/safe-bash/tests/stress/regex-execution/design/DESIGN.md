# Author proposal, not a production patch

Ownership: only new `tests/stress/regex-execution/design/**`, excluding reserved
`review/**`. Root decides integration. No delegation, new packages, product
changes, public API changes, history rewrites, or native product subprocess.

## Frozen execution allocation

Historical `df4d05b28436114e115b5c1cae9e6667ef98b810` reports six risky matrix
executions plus one earlier 13-byte execution: seven cumulative. Its freeze is
`d3f9e8d6b3cc359b5cc13361e6f440fb10997630`. The accepted 25-byte direct grep and
rg baseline was killed around 202ms, not rerun here. This task has a maximum of
five new potentially pathological executions: author uses **three**, reviewer
retains **two**. Author order: existing Pattern, worker without signal, worker
with explicit abort. Each uses exactly `^(a+)+$` against 24 `a` bytes and `!`.
No growth, fuzz, warmup, retry, or additional risky regex is authorized.
Each claim is durable before spawn. A failed risky row is preserved and stops
the family. Reviewer must coordinate the remaining allocation, not run this
author schedule again. Benign vectors and fixed linear cohorts are separately
counted; nested positive control has only four `a` bytes and a 250ms outer guard.

## Current implementation, not an invented dialect

* `src/commands/grep.ts`: UTF-8 patterns and record bytes become Latin-1 byte
  strings; common POSIX classes and BRE operators are translated. ERE passes
  through except all `(?` groups are rejected. `-F` escapes into RegExp. Native
  flags are `g`/`gi`, without Unicode. Patterns compile once per invocation,
  separately and in supplied order. No global cache. The default returns the
  first qualifying pattern match; `-o` collects then sorts start ascending and
  length descending, and the printer suppresses overlaps and empty matches.
  ASCII `-w` boundary filtering happens before first-match early return. `-x`
  wraps the expression. Numeric backreferences remain accepted. Captures are
  not a printed API but affect matching/backreferences. Flags, inversion,
  count/quiet/contextual stopping and file/stdin selection belong to the host.
  The translated regex cap is 65,536 code units (not applied on `-F`); input
  line and pattern-file collection default to 32MiB. There is no pattern-count
  or native-match work budget. Signal checks occur between records and at I/O.
* `src/commands/search/matcher.ts`: `gu`/`giu`, optional smart Unicode uppercase
  detection, combined ordered alternatives, whole-line/Unicode word wrapping;
  up to 1,024 patterns of 8,192 UTF-8 bytes each. Rejected syntax includes
  numeric backreferences and selected lookarounds, **not every named
  backreference**. This is JavaScript Unicode, not Rust regex or PCRE2 parity.
  Valid surrogate pairs advance by code point, UTF-16 positions map to original
  bytes. Invalid UTF-8 bytes split matching fragments; fragment ^/$ rewriting
  is cached in at most three additional native regexes. Empty single pattern
  is a distinct byte-offset enumeration, including terminated-record handling.
  Previous-end zero-width suppression, all/first, and 100,000 matches/line are
  observable. Match data has start/end bytes, not public captures. No ambient
  compile cache. `rg.ts` owns CRLF/NUL/binary handling and selection; shared
  Limits default to 1MiB line, 64MiB file, 16MiB output, 100,000 files. `tick`
  yields every 128 calls, not inside `Matcher.matches`. Output sinks are awaited.
* `src/commands/text-programs/regex.ts`, `shared.ts`: existing sed/awk Pattern
  uses byte strings, earliest-start/longest-whole selection plus longer capture
  preference; source 8,192, depth 64, repeat bound 1,000, code 16,384. Closed
  numeric groups may be backreferenced, with comparisons charged. Budget charges
  instructions/state visitation and buffers; defaults 5M steps and 32MiB buffer.
  `step` checks signal synchronously; checkpoint yields every 256 statements,
  not every match. Dynamic awk cache evicts first entry at 256; sed compiles
  addresses/substitutions per program. This is not a general linear-time proof.

## Smallest facade and deliberate prototype boundary

The proposed internal seam transports **native descriptors and bounded string
batches**, returns UTF-16 ranges plus numbered captures (null marks unmatched),
and leaves byte mapping, fragment creation, selection, VFS and output in the
command owner. No callable code, filesystem object or effect crosses the port.
The prototype compiles each descriptor once, resets lastIndex per record, and
advances zero-width matches according to g versus gu. First/all are supported.
It does not replace whole grep/rg commands or implement a regex engine.

The prototype tests plain accepted profile descriptors against actual grep
command output / actual rg Matcher and exact same-thread native results in
protected test children. Unsupported tool patterns never reach worker compile
in profile tests. One invalid descriptor is deliberately used only for the
worker-error lifecycle test. An existing bounded-engine result is recorded in
its original byte profile, never made the expected result for either tool.

Production needs a slightly richer request for grep word-filtered early return,
rg fragment anchor variants, and ordered multi-pattern `-o` semantics. Existing
empty-pattern byte enumeration should stay in rg's bounded host code. Raw
native UTF-16 results are not yet an rg byte API. Preserving adapters is smaller
and less risky than translating all tools to Pattern. No full profile claim.

## Lifetime, budgets and tradeoffs

Client construction does no work. Preabort is checked before validation,
allocation, compilation and posting. First use starts one static ESM worker;
the same worker serves bounded batches until awaited finally/dispose. One
inflight request, no queue; explicit host-owned Capacity permits one live
worker, rejects contention rather than silently serializing unlimited commands.
No global pool or persistent background worker. Request IDs and exact message
shapes, result ranges/count/serialization size are validated. Error, exit,
cancellation and explicit disposal settle pending requests. Termination is
awaited, event listeners removed, late termination rejection observed. Stream
yielding awaits demand and return disposes worker and closes input iterator.
As with current I/O, an uncooperative source.next() cannot be forcibly stopped;
host integration must use readBytes(signal), not arbitrary uncooperative input.

Prototype constants, not proposed public contract defaults:

| Resource | Prototype bound |
| --- | --- |
| Patterns | 16, aggregate JSON UTF-8 64KiB |
| Batch | 128 rows, 256KiB UTF-16 subject storage |
| Results | 4,096 hits, 64KiB serialized hits/batch, 4MiB/invocation |
| Invocation | 8MiB subject storage, 1,024 init+scan requests |
| Startup | 1,000ms external-to-worker timer |
| Compile and each batch | 75ms even without a caller signal |
| Total active request wall time | 3,000ms; excludes downstream stalls/startup |
| Worker heap request | old 32MiB, young 8MiB, stack 2MiB |

Test-child old-space flag is 64MiB; Node documents process-level old-space
flags overriding requested worker old-space limits. Do not call this 32MiB
effective heap or RSS containment. Subject clone/native compilation/capture
allocations and ArrayBuffers are not exactly constrained RSS. Serialization
checks bound accepted results, not all transient native allocations.

Recommendation for root decision: enable an explicit default no-signal compile
and batch deadline, total active-work/request/input/output budgets, and an
explicit host concurrency cap. Start evaluation near this 75ms batch / 3s total
profile, **not adoption without workload review**. Accommodate current valid
line/pattern maxima via approved configurable bounds, rather than silently
rejecting valid syntax as a security patch. Over-budget is a command error,
never no-match or successful partial search; bytes already written cannot be
rolled back. Larger batches amortize messages but consume more deadline and
read ahead, so quiet/max-count/streaming latency need command-level integration
tests. Batching must not wait forever for a live stream to fill: flush at input
chunk boundaries or a bounded latency, retaining ordered downstream writes.
The prototype is finite-input batching; this live-stream flush policy remains
unimplemented and must not be sold as preserved interactive latency.

Node22 ESM can emit worker.ts to adjacent worker.js with existing tsc and use
`new URL('./worker.js', import.meta.url)`. Current package publishes dist and
uses NodeNext; no runtime tsx, eval, extra package or subprocess is needed.
Root/build owner must verify actual packed consumer paths and bundler policies;
isolated build evidence alone is not published integration evidence. Worker
matching source imports only the message transport builtin and static owned
pure modules; no process/fs/network calls. Worker threads are not a malicious
host-JavaScript sandbox and do not remove ambient Node capabilities in general.

## Reproduction and frozen evidence

`node tests/stress/regex-execution/design/prepare.mjs` compiles only the listed
roots and dependency closure into owned `.build/`, captures source/build/type/
compiler/config hashes, then must be committed with all scripts before probes.
`node tests/stress/regex-execution/design/run.mjs benign` runs 30 profile rows,
one bounded lifecycle child and 144 linear benchmark children. Three repetitions,
rotated engine order, no warmups; startup and end-to-end both recorded. No
network, external oracle or user filesystem data. Parent uses only its exact
child handle, one child at a time; 250ms after-ready guards for vectors and
risks, 5s for fixed finite benign cohorts, 3s startup and 1s cleanup guards.
Streams and IPC are capped; heartbeat RSS is observational/sampled, not OS RSS
enforcement. Timing depends on scheduling and cohost load.
`run.mjs risk` claims and runs only the three author rows, never repeats.
An actual sandbox/safety refusal stops the task without a workaround.

Primary reference: Node v22.19.0 worker_threads documentation, new Worker /
resourceLimits / terminate sections, retrieved August 27, 2026 via official
Node search result. Termination returns a Promise fulfilled on exit and stops
execution as soon as possible, not real-time; engine resource limits exclude
external ArrayBuffers and cannot prevent global OOM. Prior RESEARCH R4 agrees.
An initial latest-v22 documentation open returned an empty tool result; no
previously blocked TypeScript/CLI URL was requested. Installed Node/TypeScript
versions come only from local metadata, not moving documentation labels.

## Proposed ownership handoff, no authorization implied

* Shared internal matcher owner: a production sibling of this facade/worker,
  batch/error/lifecycle budgets and small protocol tests; no public API by default.
* Grep/core owner: extract existing translator/selection without dialect changes,
  async matcher call, word filter and -o ordering, signal and awaited finally;
  command-level byte effects and early-stop tests.
* Rg owner: preserve Unicode decoder/invalid fragments, empty-byte special case,
  regex cache/word wrapper and Match byte results; async searchFile integration,
  zero-width/CRLF/NUL/context/quiet and bounded read-ahead tests.
* Root integration/build owner: approve budget/concurrency policy, any exports,
  dist worker asset/packed-consumer evidence and docs. No default host subprocess.
* Independent reviewer: review only this bounded prototype, retain up to two
  coordinated risky probes. Author results are not independent certification.
