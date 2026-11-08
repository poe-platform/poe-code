# Historical comparison execution bridge

AUTHOR implementation; **awaiting different review and ROOT candidate binding**.
No product package has been imported or measured during author checks. The accepted
preparation remains commit `2b2a5fe48142dd94238d37ec77dfd736e2117e71`; none of its
71 files is edited. Ownership is this execution directory and isolated `/tmp`.

## Commands and handoff

From the repository root, with the approved Node >=22 executable:

```sh
node benchmarks/reports/current-comparison-20260827/execution/run.mjs PREPARE
node benchmarks/reports/current-comparison-20260827/execution/run.mjs PREFLIGHT
node benchmarks/reports/current-comparison-20260827/execution/selfcheck.mjs
```

PREPARE verifies sealed input bytes and reports planned counts without children.
PREFLIGHT without binding returns `WAITING_ROOT`, exit2, zero product imports.
Selfcheck creates only explicitly synthetic real Node children/temporary fixtures,
including synthetic public-package resolution. It is NOT a cohort or product test.
It retains every attempt, before/after source identity and source copies classified
as `.data` in its printed unique `/tmp/safe-bash-execution-author-*` directory.

After review and ROOT approval, not authorized by these instructions alone:

```sh
node benchmarks/reports/current-comparison-20260827/execution/run.mjs PREFLIGHT \
  --binding /tmp/root-execution-binding.json \
  --root-receipt /tmp/root-execution-receipt.json \
  --root-receipt-sha256 ROOT_SUPPLIED_SHA256
node benchmarks/reports/current-comparison-20260827/execution/run.mjs MEASURE \
  --binding /tmp/root-execution-binding.json \
  --root-receipt /tmp/root-execution-receipt.json \
  --root-receipt-sha256 ROOT_SUPPLIED_SHA256 \
  --output /tmp/NEW_NONEXISTENT_ATTEMPT_DIRECTORY
```

Those files/hashes are placeholders, not an invented candidate. See BINDING.md.
MEASURE requires the CLI itself to run under the pinned Node executable. There is
no timing mode, budget override, native recapture, install or custom-command option.
No branch, staging or commit is performed by this bridge or this handoff.

## Inputs, algorithms and scope

- `cohorts.mjs:loadCohorts` checks v1 seal and amendment, all referenced bytes,
  ordered recipe/input hashes, original JSON.stringify recipeHash and golden
  hashes. Only amendment's three shared-control ID fields are overlaid. Executable
  preparation/historical entrypoints are read as bytes, never imported for data.
- `reuse/expanded-common.mjs` and `reuse/breadth-assess.mjs` are byte-identical
  pinned helpers. REUSE.json and DIFFS.md identify old files and bounded changes.
  Captured native golden equality, not the authenticated representative's
  old-baseline-agreement criterion, determines each224 semantic result.
- Original224 and aligned224 each have448 case/engine observations, **896 total**.
  The same224 IDs recur under different TMPDIR profiles. Breadth has136 observations
  from54 targets +7 controls +7 diagnostics. Three separate tables, no union score.
  New24/tree/file oracle preparation is unscored and nonblocking. No new du work.
- Original virtual environment omits TMPDIR and does not explicitly create /tmp;
  aligned adds TMPDIR=/tmp and precreates /tmp. VFS constructor defaults remain.
  Exact /fixture modes, file bytes/times/order, stdin and old origin projection
  are retained. Breadth keeps corrected /fixture,/tmp,/home/user, its sealed env
  overrides/configurations and complete before/after raw-metadata census.
- Exact four-field stored representations are compared by JSON.stringify; they
  are not a newly normalized comparator. Available unprojected expanded bytes are
  supplemental `observation.raw`, not a new predicate. Baseline stderr remains
  UTF-8 of public text: base64 does not reconstruct earlier lost bytes. Breadth
  retains its original public stdout conversion and existing intent predicates.
- One fresh process/Shell/VFS per observation. The old expanded empty `exec("")`
  initialization remains separately recorded in `execAdmissions.emptyInitialization`;
  scored admissions remain separate. No warmups, inventory workloads or implicit
  neutrality cases. No registered-handler wrapping, customCommands or fake engines
  in MEASURE. Registry dispatch is explicitly **not instrumented**, not zero or
  inferred from command names/type output; no new dispatch-completeness claim.
- Curl is explicit: old expanded loopback response routes/body/headers; breadth
  exact `http://127.0.0.1:63131/fixture.txt` and effectiveScript. Busy fixed port is
  setup failure, never resubstitution. Original baseline public SecureFetch
  injection is preserved for breadth; no replacement curl command. Server/socket
  limits, byte limits and natural server close add bounded orchestration only.
- Breadth's sleep0.02 existing10ms lower bound is functional sanity, not timing
  evidence. Other performance/memory sampling is removed. Optional baseline
  JS/Python/SQLite flags and provided assets remain; no private SafeJS hook or
  installation is inferred. Missing/mismatching inputs block admission, not pass.

## Actual process and capture boundary

`supervise.mjs:runAttempt(request,{executable,onEvent})` is the parent watchdog.
It starts a detached session coordinator group and tracks its engine child and
server. The supervisor event loop is outside a stalled coordinator. Session and
engine communicate via bounded length-prefixed byte pipes; guest result objects
are never accepted through unbounded Node IPC deserialization. Partial/invalid
frames, event floods, wrong IDs, duplicate results, changed bindings and oversize
captures fail. Rejected frames and bounded wire prefixes/hashes remain evidence.
Raw prefixes are explicitly incomplete where a cap prevents full capture.

The parent's absolute launch/request deadlines never reset on result delivery.
Expanded caps: 15s ready, 5s guest, 10s request including setup/settlement/snapshot/
dispose/natural close, 28s total; one-second phase limits and TERM/KILL-close grace
stay inside it. Breadth:30s/120s guest,50s/140s total, cleanup up to10s only within
remaining time, final TERM1s/KILL-close1s reserved inside total. Synthetic checks
use only the separately exported short `sentinelLimits`, never MEASURE limits.

Guest AbortSignal is forwarded into actual exec and supported byte reads/network
work. Opaque host work is not magically settled by abort; late rejections are
observed and fail. A semantic match is provisional until natural engine exit0,
both engine and coordinator exit/close, pipe EOF, server closure and owned group
absence. Any forced signal, timeout, crash, disposal error or unknown closure is
sticky failure. No routine process.exit(0), worker termination, or TERM-for-pass.
Baseline has no invented dispose API; expanded disposal phase metadata says
`apiAvailable:false`, while breadth retains `baselineDisposeAPI:false`.

Common capture caps:4MiB combined guest output,64KiB combined host diagnostics,
64MiB framed reports,4096 events/entries, depth32,32MiB snapshot/census. Expanded
per-file snapshot cap remains4MiB. Parent checks decoded bytes, not text lengths.
Child collection/public engine APIs can allocate before returning; V8 old-space
caps are not RSS/external/WASM limits. OS scheduling/filesystem stalls are not a
hard real-time guarantee or an adversarial host-JavaScript sandbox.

Root public package specifiers are resolved with Node's ESM export resolution,
using the pinned package.json scope, then the resulting bound URL is awaited.
The real synthetic module sentinel exercises this path. Main-thread loader
resolve/load/return hashes and ready-after-import are recorded. These are not
universal worker/CJS/WASM/native evaluation or syscall coverage; installed assets
are hash-pinned prerequisites, not fabricated observed reads. No audit preload
is inherited into optional workers. Host env is explicit/allowlisted, not ambient.

On unknown group closure, stop further admissions. Completed attempts never get
rewritten or retried into passes. Runtime raw files use exclusive destinations;
no failed attempt is deleted. Old BSD/native/oracle defects and breadth failures
remain in the sealed sibling evidence, unchanged by these new observations.
