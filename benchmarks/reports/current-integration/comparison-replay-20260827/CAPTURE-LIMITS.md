# Post-execution budget and capture qualification

August 27, 2026. This document qualifies derived claims in the original handoff,
README, summaries and lifecycle labels. It does **not** change either score,
golden, comparator, profile, source snapshot, dependency copy or raw observation.
The initial `summary.json`, logs and original `artifact-manifest.json` remain
immutable. The prior README is retained byte-exact as
`README.pre-qualification.md`; hashes and machine-readable accounting are in
`capture-qualification.json` and `qualification-files.json`.

This correction uses only offline reads of existing artifacts and sealed code.
No product, harness/control, performance, 224-case cohort or native oracle was
executed again. There is no new source archive or third-party dependency
vendoring. The existing planned archive and retained snapshot are unchanged.

## Budget: retrospective disclosure, not prior approval

The exact subset/control execution budget was **not fully declared in the initial
plan**. The current root handoff accepts one full224 run per profile and separately
records the already executed controls. Existing bounded controls were broadly
authorized, but this is **post-execution clarification and root disposition**, not
a claim that the exact 24-plus-9 budget was preapproved. No full cohort was
replayed and no additional execution is now authorized.

The denominator remains 224 shared functional recipe IDs, executed once per
engine in each profile. Two profile tables are not 448 unique recipes. Plain
neutrality repeats and transport checks add no unique functional coverage.

| Result-bearing calls | Original | Scratch-aligned | Both profiles |
|---|---:|---:|---:|
| Scored virtual-bash recipe observations | 224 | 224 | 448 |
| Scored just-bash recipe observations | 224 | 224 | 448 |
| Plain virtual-bash neutrality observations | 12 | 12 | 24 |
| Plain just-bash neutrality observations | 12 | 12 | 24 |
| Baseline-only transport observations | 9 | 9 | 18 |
| Total recipe/transport observations | 481 | 481 | 962 |

Each profile therefore has 448 scored engine results, **24 additional plain
neutrality calls** and **nine additional baseline transport calls**. The 24 plain
calls compare against retained traced results from the scored224; there are no
additional traced neutrality executions. All 24 comparisons pass. These controls
repeat these 12 existing recipe IDs for both engines:

- `command/echo/multiple`
- `command/cat/binary-stdin`
- `command/patch/apply`
- `command/chmod/numeric`
- `command/stat/fields`
- `command/mktemp/file`
- `command/sed/substitute`
- `command/jq/map`
- `command/tar/roundtrip`
- `command/join/fields`
- `network/curl/get`
- `network/curl/post-stdin`

The nine transport observations per profile are three inputs (`invalid-utf8`,
`utf8`, `nul-ascii`) crossed with `cat`, `cat | base64`, and `cat > output`.
They execute directly in the phase process, not new session workers. Eight pass;
the invalid-UTF8 terminal output mismatch remains a failure. Its internal pipe
and file controls pass; that does not justify an internal-corruption claim.

The preceding controls phase additionally records **15 passing harness tests**:
seven original-version tests and eight aligned-version tests. These are protocol,
golden and helper checks, not 15 guest recipes. It starts/closes **four startup-only
engine workers**, two per harness version, without `worker.run` calls. Inventory
reads are distinct: two in the controls phase and one in each functional phase,
**four inventory invocations total**, in the phase processes. They import APIs and
inspect/construct registries; the sealed inventory code contains no shell script
execution. Do not count inventory queries as four additional recipe workers.

There is also an explicit initialization cost hidden by an observations-only
count. The sealed engine calls `await shell.exec("")` once before each virtual-bash
observation, including plain controls. Thus code plus complete observations
implies **236 empty initialization exec calls per profile**, 472 total. Warmup is
zero. Counting only explicit harness `Shell.exec`/`Bash.exec` call sites yields
**717 per profile, 1,434 total**, including those empty calls. This is a
control-flow-derived API invocation count, not an event-logged command count;
commands and nested evaluations inside scripts are not enumerated by it.

Evidence distinction: the 896 scored results, 48 plain results and 18 transport
results are directly countable stored observations. The 944 session observation
requests, empty exec calls, inventory invocations and successful startup
handshakes are inferred from sealed control flow and completed outputs. Local
response `id` fields survive in results, but there is **no request/result IPC
trace joining PID, request ID and recipe ID**. No such ledger has been invented.
The original `summary.json` fields `engineObservations: 896` and
`rawObservationRows: 448` describe only the scored tables, not the full call budget.

## Import proof: attempts versus successful entry imports

The loader writes its `module-load` record **before calling/awaiting `nextLoad`**.
It records an attempted file URL, its real path and the on-disk source hash. It
has **no resolve hook**, successful-return event, transformed-source capture or
evaluation-completion event. The old field/event names are retained as raw data;
their names do not establish successful loading or evaluation.

- Each functional profile: **3,096 attempt events**, **337 distinct attempted
  URLs**, **310 distinct attempted file paths**. Distinct URLs and real files are
  different counts. This is not proof that 310 modules evaluated successfully.
- Controls phase: **609 attempt events**, **186 distinct attempted URLs**,
  **181 distinct attempted file paths**.
- Recorded attempt paths stayed within the freeze and their disk hashes matched
  the seal. This does not prove a complete import closure or absence of other
  resource loads. There is no complete CJS require, WASM asset, native-addon,
  syscall, thread or socket trace.

The selected public entry has stronger, specific evidence: sealed `engine.mjs`
awaits the chosen frozen `src/index.ts` or pinned comparator entry import before
sending `ready:true`; sealed `session.mjs` must receive ready before resolving
startup. The completed control phase implies four successful entry handshakes;
completed functional phases and observations imply 26 each. Raw ready messages
were not separately logged. This supports successful selected entry imports and
working APIs under that control flow; it must not be generalized into successful
evaluation of every attempted module or a full resolve/load/dispatch trace.

## Lifecycle: bounded managed cleanup, not voluntary guest cleanup

Offline examination of existing child and outer-supervisor records finds:

| Phase | Recorded engine child starts/exits | Exit kind | Outer result | Recorded leaks/residuals |
|---|---:|---|---|---|
| Controls | 4 / 4 | all `SIGTERM` | exit 0 | none / none |
| Original | 26 / 26 | all `SIGTERM` | exit 0 | none / none |
| Scratch-aligned | 26 / 26 | all `SIGTERM` | exit 0 | none / none |

All 56 recorded starts pair with one exit and a worker-start event using the
recorded parent/numeric PID. All scored and plain results contain observations
without timeout or engine/harness error. No `SIGKILL` exit, outer timeout, leak
trigger or residual is recorded. The existing stderr logs are empty. Nothing in
this review turns a recorded leak or escalation into a pass; none is observed.

Expected `SIGTERM` is deliberate: unchanged `session.close()` sends it to its
still-running IPC worker and awaits exit. The sealed phase serially awaits every
run and closes fresh plain workers in `finally`; persistent workers close after
the calls finish. The observations and completed phase therefore support settled
managed calls followed by routine session termination. No explicit termination
request/purpose event or PID-linked last-request record was captured. The purpose
and lack of escalation are **inferences from sealed code plus the existing
events/results**, not a fabricated event trace or an all-signals-pass policy.

The appropriate gate remains **bounded managed-session/process-group cleanup
PASS, with zero leaks observed**. It does **not** prove that guest-created workers,
threads or other resources voluntarily terminated. In particular, a baseline
observation's disposal hook is a no-op; stopping the enclosing session process
can terminate resources that remained inside it. The record cannot certify
per-guest voluntary cleanup.

The outer census uses numeric PIDs/parent/group and command text, without OS birth
identities. It is not a complete identity-safe lifecycle ledger. Awaited
`server.close()` control flow, the phase cleanup booleans and normal outer exit
are bounded closure evidence, **not an independent socket/listener event monitor**.
No additional executions will be used to fill these capture gaps.

## Unchanged scores, source and performance limits

Original remains **222/2 versus 155/69**; aligned remains **223/1 versus 155/69**.
The source/profile/native qualifications stand. The one-point difference remains
the separately preserved scratch golden effect, not changed product behavior.
No additive union or broader unique-coverage claim is made.

**Performance is not authorized now and was not run on this freeze.** Any retained
historical timings retain their original source, matching-output, trial, hardware,
cohost-load and measurement-scope caveats. Functional elapsed/memory fields do not
become a current frozen performance result. No existing or proposed performance
adapter is executed by this qualification.

For final review, read `capture-qualification.json` alongside the immutable raw
artifacts. `qualification-files.json` records the changed documentation hashes and
verification that the original listed artifacts, other than the intentionally
qualified README, remain unchanged. The original README hash is satisfied by
its byte-exact retained copy, not by silently resealing the original manifest.
