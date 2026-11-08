# Independent final runtime containment review

**Current status:** execution stopped after five scoped passes; `rg-queued-abort`
remains UNUSED. The reviewer's shared-worker ownership ambiguity was resolved
read-only, but STOP remains latched and no further execution is authorized here.
See `REPORT.md`, `evidence/STOP.json` and `evidence/final-audit.json`. Instructions
below preserve the original phase-1 preparation and once-only execution protocol;
do not rerun them or clear the claims/STOP to complete the missing slot.

Phase 1 only until ROOT grants the exact six-slot gate. Never execute child modules
directly. No automatic retries or matrix loop. Original historical probes, original
five, first-read controls, benchmarks and fixture-author compiled runs are separate.

`prepare.mjs` verifies 216 source identities against their exact commits and frozen
snapshot, all 704 emitted files against snapshot AND actual moved package, archive,
public entry and worker/client/protocol assets. It uses its own private package
boundary and a node_modules symlink to the real moved package, preventing the
repository self-reference trap preserved in 352652a. Compilation covers only own
static JS modules and the exact corrected fixture with one public import replacement;
allowJs emission is NOT JavaScript typechecking or global production qualification.

The expectations commit is a3d3f77. The first author correction 5a93969 preceded it
by 10 seconds; the expectation text was prepared before reading that correction or
the ready marker, not before the author's commit. The final exact fixture is
8d0909ff3cf29290051e3d91dc3205e629ef6bda. The archived diff preserves the original
wrong-layer 7/8 evidence. Correction selects actual ShellLimitError execution
rejection, keeps four caller-reason variants and adds separate ordinary Error
status/diagnostic plus exact one/two cleanup-error controls. No source changes.

Queue controls hold only actual nonempty benign matching replies. Each sibling
first posts one empty validation request, then one nonempty benign request. Both
nonempty replies are held unchanged. The third public invocation queues its empty
validation request: no third worker and no third invocation's postMessage. An
AsyncLocalStorage-scoped transparent addEventListener observer recognizes the
frozen client's pending-abort callback by its queue-removal source marker, records
its SHA256, and observes admission after the synchronous queue push/pump. All five
admissions must have identical callback hashes. This is trusted observation of a
protocol/control boundary, not a queue API, worker mock or catastrophic matching.
The product has four sibling protocol requests, only two benign matching payloads;
none counts as a pathological exposure. The four single probes each have an empty
validation followed by exactly one nonempty pathological request.

Parent heap is 128 MiB/stack 1024 KiB; original product workers remain 128 MiB old
generation/4 MiB stack. Six-second single and eight-second queued watchdogs begin
at fork, independent of ready. Output 16384 bytes combined, IPC 65536 bytes total.
Timeout control's 75 ms exact-child kill tests supervision only, never defaults.
Worker/native-call entry is not instrumented; acceptance plus ready and no reply
does not prove native entry. Timer/abort bounds are diagnostic, not SLAs. No RSS,
universal preemption, superiority or performance acceptance claim is made.

Commands from the repository root, one at a time:

```
node --unhandled-rejections=strict tests/stress/regex-execution/runtime-containment-final-review/prepare.mjs
node --unhandled-rejections=strict tests/stress/regex-execution/runtime-containment-final-review/guard.mjs controls
node --unhandled-rejections=strict tests/stress/regex-execution/runtime-containment-final-review/guard.mjs benign
```

STOP after the benign handoff. ROOT must supply JSON at
/tmp/regex-containment-six-authorized.txt containing these exact keys:

```
{
  "authority": "ROOT_EXPLICIT_EXECUTION_AFTER_REVIEWED_BENIGN_GREEN",
  "preparedSha256": "<evidence/prepared.json SHA256>",
  "benignSha256": "<evidence/benign.json SHA256>",
  "controlsSha256": "<evidence/controls.json SHA256>",
  "sourceCommit": "1b133a8662a32ee84524794842074c9c98d5f6c3",
  "archiveSha256": "86c34e382c85563afbd9c760aa2e0f161308e8f43e14fe99dfec9ed96d77539b",
  "fixtureCommit": "8d0909ff3cf29290051e3d91dc3205e629ef6bda",
  "reviewedIndependentBenignGreen": true,
  "noConcurrentLifecycleProbesOrPerformance": true,
  "totalTargetBudget": 6,
  "totalPathologicalRequestBudget": 4,
  "jobs": ["grep-default", "rg-default", "grep-abort", "rg-abort", "grep-queued-abort", "rg-queued-abort"],
  "expiresAt": "<explicit future ISO timestamp>"
}
```

After ROOT's gate, run guard with exactly one job name. Inspect its complete result
before considering the next. For each prior passing job, write a durable independent
inspection JSON named `evidence/<job>-inspection.json` with its `resultSha256` and
`decision: "PASS_REVIEWED_CONTINUE"`, plus actual findings. Never create these
automatically. The guard checks all earlier inspected passes, all later unclaimed
slots, current source/package/harness hashes and gate bindings. Claims are exclusive
and fsynced before fork, followed by an fsynced journal. A global exclusive lock
prevents concurrent children. Any failed target writes STOP; a stale claim is not
permission to rerun. Remaining slots stay unused. Parent kill means target FAIL.
