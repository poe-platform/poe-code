# Markdown query resource stress QA

Execute this plan manually against a recorded revision. Keep generated fixtures,
measurement helpers and raw output in `out/mdq-stress`; remove them after recording
reproduction parameters and observations in the internal task tracker. Do not add
slow stress runs to the unit suite.

## Environment and oracle

Record OS/architecture, runtime versions, CPU/memory, revision and configured
resource limits. Use synthetic Markdown with deterministic repetition (seed 1908).
Use native mdq 0.10.0, commit c4eccd0e340ad32f966ee8675c093dabe1005ee0,
when available. Compare stdout bytes, status and diagnostics separately; oracle
panics and harness limits are not automatically product defects.

## Large documents

Through real Shell/VFS and the typed SDK, run three repetitions for 100, 1,000
and 10,000 sections, then increase payloads to multi-megabyte documents. Each
section has a unique heading, Unicode text and a deterministic numeric marker.
Select first/middle/last chapters, a missing chapter, and the complete document.
Compare expected chapter bytes and native output. Record UTF-8 input/output bytes,
wall milliseconds, process RSS/heap observations and SDK logical accounting.
Never describe cumulative allocation accounting as live memory or RSS.

Repeat with repeated headings, 32/128/512 nested quotes, long single lines,
large fenced blocks, 100/1,000/10,000-row tables, references/entities and
1/16/128/512 selector stages. Check output completeness or explicit rejection.
Use process deadlines for pathological cases and record deadline exhaustion as a
failure requiring diagnosis, never a pass.

## Resource boundaries

Defaults are Infinity, so there is no finite default byte boundary. Configure
finite inputBytes, outputBytes, retainedBytes, nodes, references, tableCells,
text, entities, entityBytes, depth, work, arguments, argumentBytes, files and
emptyChunks. Find each fixture's minimum successful budget and rerun one below,
at and one above it. Check correct output at/above and a named resource failure
below, without partial output falsely reported successful. Also exercise zero
and invalid limit configuration. Probe documented regex source/group/instruction
bounds separately from configurable invocation limits.

## Streams and lifecycle

Split UTF-8 at every byte and around 4096/16384-byte boundaries; reuse and mutate
the producer's buffer after each yield. Compare byte-identical output. Gate a
consumer write with an explicitly released promise to verify backpressure and
cancellation without arbitrary sleeps. Check early downstream termination,
source/sink failures, iterator finalization and idempotent registered cleanup.
Exercise cancellation during parsing, selection and output, retaining the exact
caller reason. Run repeated invocations and concurrent independent Shells with
unique markers, then dispose them. Record post-GC heap observations as evidence
with noise/retention limitations, not proof that no leak exists.

## Filesystem, API and distribution

Read only supplied memory VFS fixtures. Verify host paths are unavailable,
read-only VFS queries succeed without writes, and missing/permission/erroring
reads fail explicitly. Compare command argv and typed SDK options through Shell
contexts. Execute maintained command and real Shell integration tests. Build the
maintained safe-bash workspace closure and test packed exports without private
workspace resolution. Identify Node/browser/workerd or other supported runtime
profiles from maintained declarations; distinguish executed runtime checks,
build-only checks and unavailable evidence explicitly.

## Failure handling and delivery

Minimize each suspected failure; rerun it independently and search internal
reports for duplicates. Immediately file each new validated defect as open,
unassigned and non-draft with safe-bash/mdq labels, input/query, source and oracle
revision, environment, limits, expected/actual result, reproduction command,
severity and regression criteria. Link prerequisite and audit internally, without
blocking workers on audit completion. Preserve reproductions and concise raw
observations before cleaning temporary files. Commit this plan and any focused
regressions/fixes, verify delivery on remote main, then record coverage and
outstanding defect references. Unexecuted profiles must remain explicitly
unavailable and unresolved defects stay open.
