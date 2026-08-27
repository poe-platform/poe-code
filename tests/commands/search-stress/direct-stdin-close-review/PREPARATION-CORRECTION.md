# Preparation correction before candidate routing

Original frozen files remain byte-for-byte unchanged at commit `3152f330`.
First execution is permanently retained at `runs/baseline-01`, commit `62699e8d`:
13 passing cases, four contract-failing cases, one sibling fixture watchdog.
Do not relabel this original 18-case run as all naturally exited or fully valid.

The sibling fixture attempted to change `iterator.next` after iterator acquisition.
The baseline's `for await` retains the originally acquired next method, so later
reads repeatedly returned the already-resolved pending result instead of EOF.
The parent stopped only the exact child PID 75937 after 30 seconds. This is a
review fixture implementation defect, not product sibling-isolation evidence.

`prepare-fixture.mjs` repairs only fixture preparation for subsequent executions:
the originally acquired next method itself returns EOF after the survivor's one
released chunk. This restores the already-frozen schedule (pending next, release
`hit\n`, then EOF). It changes no assertion, expected byte, status, counter,
resource condition, order, limit, signal, regex, or production code. All original
assertion-call lines are separately authenticated unchanged. Exact two textual
replacements and original/prepared SHA256 are recorded in each new preparation.
The unchanged original `cases.mjs` remains committed; the corrected executable
copy has a distinct disclosed hash. Do not call it an unchanged executable replay.
Both versions are frozen BEFORE any candidate has been routed or inspected.

A second preparation bookkeeping defect checked a context-only Markdown contract
against the materialized TypeScript build-input tree. The original false
`sourceUnchanged` field is retained. Subsequent checks use the exact `build-input`
classification; missing context bytes are not silently omitted from the original
provenance. The original source-before/source-after lists permit reconstruction.

Root's coverage note was read after initial freeze. These ordinary fixed-pattern
cases actually create workers on this baseline: all 15 non-preaborted product
cases with completed JSON contain a real constructed moved worker URL, a matching
worker-entry SHA256 and its exit event. There is no need to add a regex corpus or
alter frozen patterns. The two no-worker controls intentionally create none.
Worker static import hashes are authenticated by the full package inventory;
the main-thread module hook does not claim dynamic worker-import instrumentation.

Direct-host contract: synchronous structural return closes its resource at call
time. On abort, signal-aware readBytes can schedule return without waiting for
opaque work. On a non-aborted quiet success, cooperative asynchronous return must
complete before the handler returns. Registered invocation hooks concern regex
resources, not a universal barrier on arbitrary raw host stdin/sink promises.
