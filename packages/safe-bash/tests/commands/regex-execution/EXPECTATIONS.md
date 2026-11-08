# Production author expectation freeze

Written before production edits or author execution. Existing native goldens,
design, revision, validation and independent-review artifacts remain immutable.
The independent production verifier owns baseline capture and broad timing.

Required benign checks:

1. Actual grep and rg command status/stdout/stderr preserve byte-oriented grep,
   JS ordered alternatives, numeric grep captures/backreferences, rg Unicode
   case/word rules, invalid-UTF8 fragment anchors, empty-pattern byte positions,
   invalid-pattern diagnostics, selection, NUL, CRLF and explicit stdin behavior.
2. Pre-aborted requests create no workers or queue entries and read no source.
   Abort during startup/request waits for exact worker termination, removes
   listeners, preserves the caller reason and does not cancel another caller.
3. FIFO admission is bounded by request count and descriptor+row input bytes.
   Queued abort removes its entry; an overflowing request has a typed resource
   error; distinct configured executors do not share a process-global slot.
4. Request leases are absent at source/sink/VFS waits. Live feedback does not
   deadlock; early selection/consumer return causes no speculative source read.
   Available complete records can share a request, and workers are not created
   per line. Idle workers cannot keep the process alive and eventually retire;
   final invocation cleanup awaits worker termination.
5. No descriptor-session cumulative request/input/output budget survives across
   invocations. More than 1024 requests, 16 patterns, 4096 matches and 64KiB
   result payload must not inherit historical prototype rejection thresholds.
6. Worker exit/error/malformed replies clean exact resources and settle once.
   Active timeout and startup timeout are distinct; default values are inspected
   as 1000ms/3000ms, not measured using prohibited long pathological runs.
7. Compiled and moved actual PRODUCT package includes static ESM worker assets;
   public command factories work without development loaders or runtime deps.
8. Host-thread construction tripwire must cover compile validation and invalid
   UTF8 fragments; worker matching graph must not access FS/network/subprocess,
   eval or generated source. Worker resource limits are not RSS containment.

Pathological allocation: author 0/2 claimed, independent maximum four. This
document is not a claim to execute a pathological probe. Every such probe needs
its own durable claim before execution, static checked-in isolated child, benign
controls, <=250ms after-ready watchdog, bounded output/heap, exact cleanup and
no retry. Prior historical twelve and revision-zero runs stay separate.
