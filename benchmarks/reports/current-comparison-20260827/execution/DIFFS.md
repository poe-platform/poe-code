# Source-to-bridge changes for independent review

REUSE.json names immutable Git sources, original hashes and current adapter hashes.
The committed old engine entrypoints are never imported to obtain recipes.

## Unchanged predicates

- 0294afb6e690433aed994868e5ed437ecf58ae48:benchmarks/expanded/common.mjs is copied
  byte-for-byte to reuse/expanded-common.mjs, including projectBytes, snapshot's
  sorted traversal, mode selection and four-field JSON.stringify comparator.
- 849dbf18b1e865c7d12927c11f0e20ba0555c540:benchmarks/reports/baseline-only-20260827/
  coverage-execution/assess.mjs is copied byte-for-byte to reuse/breadth-assess.mjs.
  Every existing status/base64/includes/excludes/file/preservation/sleep predicate
  and classification remains. The outer lifecycle gate prevents its historical
  lack of an independent cleanup.error check from earning operational credit.

## Expanded observation adapter

expanded.mjs retains the old observe body and public byte API conversions, fixture
creation/modes/times/order, script substitution, constructor limits and snapshot.
It accepts an already authenticated public library rather than importing old
src/index.ts. The explicit aligned branch reproduces the actual d1b10a3 delta:
TMPDIR=/tmp and precreated /tmp. Original leaves both explicit changes absent.

The existing empty-shell initialization is recorded separately. Registry wrappers
and middleware observation are omitted, avoiding command shadowing/extra neutrality
workloads; old predicate ignores those telemetry fields. No dispatch proof is
claimed. AbortSignal is parent-controlled, available byte reads are bounded, and
finally now covers setup/initialization errors as well as execution. Disposal
metadata explicitly distinguishes real product dispose from absent baseline API.
Warmups, GC, polling memory sampler and execution timing fields are removed. Old
available unprojected byte results are retained separately from scored projection.

## Breadth observation adapter

breadth.mjs retains corrected attempt002 engine-child algorithms: fixtures, raw
metadata, full-root before/after census, configurations, legitimate public fetch,
input options and stdout/stderr conversions. Paths are checked using existing
relativePath; collected census bytes are checked after read as well as stat size.
Public library import, signal and bounded lifecycle events are supplied by the
bridge; no engine or command is replaced. Only sleep's existing functional clock
remains. Old IPC result send, inherited loader registration and sampled memory
are removed. Final report still contains capture/exec/cleanup failures.

## Orchestration differences that are not unchanged-harness claims

The old expanded session's TERM-on-close and the breadth author's/reviewer's
result-clears-total-deadline behavior are intentionally not reused. The
authenticated driver-lifecycle's distinct ready/request/response/late-settlement
and closure accounting patterns inform the small real supervisor instead.
An independent parent owns one process group per observation. Framing bounds
bytes before deserialization; deadlines remain absolute through result, cleanup
and fallback. Unknown group closure stops admission. Original baseline agreement
from the8 representative authentication calls is not substituted for native match.

network.mjs adapts 0294afb6:benchmarks/expanded/server.mjs routes/bodies/headers,
and attempt002 run.mjs's fixed breadth server. Added request/socket/header/body
caps may fail pathological infrastructure but never relax recipe expectations.
Fixed breadth port and literal effectiveScript stay unchanged. Natural server
close is required; forced process-group cleanup is failure, never a passing close.

The main-thread resolve/load observer adapts 010411ef's observe-load.mjs to exact
member hashes and bounded events instead of an unbounded append-only observer.
Standard public package export resolution is checked before awaited import. It
does not claim to trace every optional worker, asset read, CJS/native evaluation
or child process. Host JS remains trusted; process groups and scrubbed host env
are orchestration controls, not a general syscall/network sandbox.

The new run.mjs uses exact sealed JSON and old alternating expanded order / reviewed
shared-controls-first breadth order. It never imports old phase/run/freeze scripts,
launches native utilities, copies live product source, installs packages, or runs
new holdouts/performance/control cohorts behind the requested denominators.
