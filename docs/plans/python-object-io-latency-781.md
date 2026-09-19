# Python object I/O latency qualification — issue 781

## Objective and evidence boundary

Implement a portable delayed/counting qualification benchmark, not a speculative
runtime optimization. Base: `3eae1df1fc87219fb6fbe761e4327f2a417ac7cb`, detached HOME
worktree `issue-781-object-io`. Main owns registration, hosted resource lifecycle,
CI, integration, commits and delivery. This worker does not commit or push.

The original consumer run `35410198572` independently verified canonical bytes:
9 MiB, 94,023 ms, SHA-256
`b8b5dabaa3454f7fa46a97c51cec9ccd118ffc0d61df6e46d845ef200a2fd1bb`;
100 MiB, 922,009 ms, SHA-256
`4cbf988462cc3ba2e10e3aae9f5268546aa79016359fb45be7dd199c073125c0`.
Both had zero private pages. That run failed later directory cleanup; corrected
run `35411441873` succeeded separately. Those are aggregate observations without
phase/request counts, not evidence of an upstream algorithm bug or its cause.

Local results below use actual Python 314.0.6, the native JSPI filesystem boundary,
and same-isolate workerd, with Miniflare R2 backing and optional synthetic delay.
They are **not hosted Worker qualification**, production consumer CAS
qualification, Cloudflare latency estimates, or a before/after runtime patch.

## Protocol and reusable fixtures

Entry: `packages/safe-bash/tests/integration/python-object-io-781.test.mjs`.
The runtime builder authenticates all five pinned Pyodide files and all 96 static
callback modules, rejects source selection outside the exact candidate checkout,
and enforces both the Worker unhandled-error gate and runtime-error gate.

The exported `qualifyPythonObjectIo781(createFixture, configuration)` in the Worker
accepts an external factory. It receives `{metrics, chunkBytes, delayMs}` and
returns `{fs, store, events, owner, readCanonical(path), dispose()}`.
`readCanonical` returns `{size, body}` with a byte/BYOB readable stream. This allows
the identical Python program, counted phases and final-summary protocol to use
a host-supplied object store; it does not manufacture that store's CAS guarantees.

The default factory reuses `createR2StagingFixture`, with `delayObjectIoBackend`
counting/delaying each actual PUT/GET/LIST/DELETE admission. Delay is not inserted
per Python syscall or per streamed upload chunk. Namespace/CAS is process-local;
staging uses fixed page keys, not the consumer's fresh revision keys and extra
overwrite DELETEs. Do not translate this fixture's counts into consumer counts.
All eight existing object-publication/staging conformance cases run against it.

Bounded helper edits, independently reproduced with failing tests, allow staging
against an unchanged nonempty revision, provide canonical Python stat metadata,
and abort the publication pump if backend upload fails. The last regression
originally timed out with a rejected in-memory upload; it now settles promptly.
No product descriptor, Python executor, public runtime API or package manifest
changes are made.

## Hosted contract

Bind **only a newly created qualification-only R2 bucket** as `SCRATCH`.
The deployment driver must independently attest bucket/Worker ownership; the
fixture's `QUALIFICATION_OWNER` string alone is not bucket ownership authority.
Never bind a production bucket or an existing preview's storage.

Bindings:
- `QUALIFICATION_TOKEN`: secret bearer token, at least 32 characters.
- `QUALIFICATION_OWNER`: nonempty owner identifier, at most 128 characters.
- `QUALIFICATION_EXPIRES_AT`: epoch milliseconds, at most one hour in the future.
- `SCRATCH`: the new qualification-only R2 bucket.

All routes require authenticated `POST`, `Content-Length: 0`, no request body and
no `Transfer-Encoding`. Send `Authorization: Bearer <token>`.

- `/ready`: no storage/Python replay; `{ready:true,owner,expiresAt,protocol,active}`.
- `/conformance`: runs the eight small existing protocol cases, returns their names.
- `/unhandled-errors`: returns the current isolate's errors for local extra gating;
  hosted acceptance must use each final summary, not assume the next request uses
  the same isolate.
- `/cleanup`: drains the entire qualification-only bucket in batches of 100,
  at most 32 LIST pages; returns `{owner,expiresAt,removedObjects,listedPages,
  remainingObjects:0,truncated:false}` only after an acknowledged empty final LIST.
  Exhaustion/failure returns failure, not an emptiness claim. Authenticated cleanup
  remains allowed after expiry so expired workloads cannot strand owned objects.
  All other routes reject expired credentials. Controls reject query parameters.
- `/object-io-781`: accepts exactly the query controls below, each once.

| Control | Supported values |
| --- | --- |
| `size` | `9437184` (9 MiB only; no retained 100 MiB allocation) |
| `chunkBytes` | `65536`, `262144`, `1048576` (object page/publication chunk) |
| `callerBytes` | `65536`, `262144`, `1048576` (Python write/read caller chunk) |
| `maxTransferBytes` | `65536`, `262144`, `1048576` (native **and** Python FS dispatch limit) |
| `workingPages` | `1`, `4`, `16`; page × pages must be at most 1 MiB |
| `delayMs` | `0`, `5` (synthetic delay per backend method admission) |

Response content type is `application/x-ndjson`, not an early metrics header.
Records `{type:"chunk",offset,base64}` have at most 65,536 decoded bytes, in
contiguous order. Hash these decoded bytes incrementally; never collect the file.
Exactly one final `{type:"summary",completed:true,canonicalBytes,phases,...}`
follows canonical EOF, completed private/canonical fixture cleanup, and the
Worker error-observation turn. Failure/cancellation cannot emit a success summary.
The final summary includes `owner`, Python exit/stdout/stderr, zero private/fixture
object counts, lease/staging balances and `unhandledWorkerErrors`.
It needs no persisted receipt or follow-up request affinity.

Sequential hash is the original 9 MiB hash above. The final canonical bytes after
the fixed positioned edits hash to
`ee98d04569d114da547c22488141b6efe21d77c13a128c2062728dc7e2c3c59f`.
Check both Python hashes and the independently decoded canonical SHA-256, exit 0,
empty stderr/errors, completed final summary and 9,437,184 decoded bytes.

## Phases and denominators

Every case has a fresh interpreter, writes 9 MiB, publishes on close, hashes via
Python, executes 12 one-byte positioned writes (four spaced offsets, three
iterations), publishes again, and hashes again. Positioned reads verify immediate
read-your-writes, unchanged seek position, and immutable retained-reader bytes
after replacement. Permissions are checked through actual Python stat.

Phases are setup, runtimeStartup, pythonSetup, sequentialWrite,
sequentialPublication, pythonReadback, positionedIO, positionedPublication,
positionedReadback, pythonFinalization, executorRetirement, independentReadback
(canonical GET admission), canonicalStream (bounded BYOB drain/encoding),
fixtureCleanup, complete. `hostStreamReadbackMs` includes receiving/decoding the
NDJSON and the final cleanup summary; it is not pure R2 read latency.

`syscall.*` counts are **actual native host dispatch requests**, not host OS
syscalls or a separate count of WASI entries. A caller chunk exceeding the native
limit can create multiple dispatches. Sequential bytes are 9,437,184; caller writes
are size / callerBytes; positioned writes are 12 bytes in 12 calls, with 17 total
positioned read bytes including the retained-reader checks across phases.
Operation duration is admission through resolution, attributed to its admission
phase. Nested/concurrent operation durations overlap; do not add syscall/backend
durations to reconstruct phase wall time. All backend categories include cleanup.

## Measured local tradeoffs (September 19, 2026)

Final source run: 16 cases, 72.59 s; all exact hashes, zero errors, balanced
resources and empty bucket. Installed public Safe Bash/FS/JS `0.1.695` separately
passed the same 16 cases in 72.79 s, including readiness and recovery cleanup.
Focused checks pass 67 unit tests, two launcher tests, and safe-fs typechecking.
One sample per configuration in each artifact mode, no statistical speedup
claim. Rows below are the 5 ms synthetic-delay samples. Matched profiles set caller,
native transfer and page to the same size. The mismatch holds caller/native at
64 KiB while changing only page to 256 KiB.

| Profile / working pages | Write ms | Publish ms | Python hash ms | Positioned ms | Write PUT / GET | Publication GET / DELETE | Hash GET |
| --- | ---: | ---: | ---: | ---: | --- | --- | ---: |
| matched 64 KiB / 1 | 1664 | 1945 | 826 | 258 | 145 / 0 | 144 / 144 | 144 |
| matched 64 KiB / 4 | 1666 | 1945 | 823 | 272 | 145 / 0 | 144 / 144 | 144 |
| matched 64 KiB / 16 | 1708 | 1965 | 826 | 259 | 145 / 0 | 144 / 144 | 144 |
| matched 256 KiB / 1 | 868 | 537 | 225 | 275 | 37 / 0 | 36 / 36 | 36 |
| matched 256 KiB / 4 | 875 | 536 | 225 | 273 | 37 / 0 | 36 / 36 | 36 |
| matched 1 MiB / 1 | 649 | 181 | 80 | 318 | 10 / 0 | 9 / 9 | 9 |
| mismatch 256 KiB / 1 | 2666 | 538 | 826 | 272 | 145 / 144 | 36 / 36 | 144 |
| mismatch 256 KiB / 4 | 2631 | 533 | 825 | 272 | 145 / 144 | 36 / 36 | 144 |

The extra write-phase PUT is zero-length initial publication on create, not an
extra data page. Sequential publication adds one canonical PUT in every profile.
Runtime startup was 944–1001 ms in these rows; canonical NDJSON drain 138–140 ms;
final fixture cleanup 35–38 ms. The full raw receipts retain every phase/category.

- At the same 1 MiB configured resident-page budget, matched 64/256/1024 KiB
  profiles still have respectively 144/36/9 sequential data pages and dispatches.
- Increasing working pages alone did not change requests in this spill fixture;
  do not advertise larger working sets as an existing read-ahead optimization.
- Larger matched pages lower sequential request counts, but the 12 tiny positioned
  writes spill respectively 0.75/3/12 MiB. Their data amplification is a real
  tradeoff in this model, not improved random-write efficiency.
- The mismatch's sequential spill bytes are 36 MiB versus 9 MiB for matched
  profiles. It adds read/modify/write requests rather than using the already
  optimized aligned complete-page producer path.
- Resident-page configuration is not total RSS or measured peak JS memory. Runtime
  heap, native transfer/caller buffers, page scratch, publication and bounded
  64 KiB NDJSON encoding add memory. Observed initial/final WASM heap is 30 MiB;
  these two observations do not establish peak memory or constant metadata size.

## Reproduction and authenticated export

From this candidate worktree, authenticate HOME tooling with:

```sh
export SAFE_BASH_CF_RUNTIME_ROOT=/home/kjopek/project/poe-issue-worktrees-20260918/issue-763/out/issue763-workerd
export MINIFLARE_WORKERD_PATH="$SAFE_BASH_CF_RUNTIME_ROOT/workerd-local.sh"
export SAFE_BASH_PYTHON_RUNTIME_ROOT=/home/kjopek/project/poe-code/packages/safe-bash/tests/integration/pyodide-runtime/node_modules/pyodide
mkdir -p out/issue-781/runtime-fresh
export TMPDIR="$PWD/out/issue-781/runtime-fresh"
export SAFE_FS_EXPORT_WORKER_DIR="$PWD/out/issue-781/export-fresh"
unset SAFE_BASH_PYTHON_CONSUMER_ROOT
node --experimental-strip-types --test packages/safe-bash/tests/integration/python-object-io-781.test.mjs
```

Each export directory must be new; the builder never overwrites qualified assets.
`qualification.json` includes `{artifacts:[{name,type,bytes,sha256}],
compatibilityDate:"2026-09-17",mainModule:"main.mjs",protocol,...}`. It contains 105
modules, including all 96 callbacks, and candidate/public input SHA receipts.
Export occurs only after all cases and local error/cleanup gates pass.
Completed exports are `out/issue-781/export-source-final/qualification.json` and
`out/issue-781/export-public-final/qualification.json`; the latter additionally
records the official binary and HOME launcher SHA provenance. Complete local
results are in the corresponding `runtime-source-final/results.json` and
`runtime-public-final/results.json` under `out/issue-781`.

On Ubuntu 24.04 Linux x64, install `miniflare@5.20260917.0-alpha`,
`workerd@1.20260917.1` and `pyodide@314.0.6` under owned out directories. Point the
tooling root at its package.json directory and Python root at
`node_modules/pyodide`. **Unset** `MINIFLARE_WORKERD_PATH` to use official workerd;
an explicit official path is also accepted. Only HOME needs the explicit sysroot
wrapper. The pinned official Linux x64 binary is 131,842,216 bytes, SHA-256
`0484ac0dc3fc402881e5d9c459682333f1a9e6d0b89d2fa82f9fa67c065b2dde`.
The generator streams its hash and records binary/launcher provenance.

Public-runtime mode, with no workspace symlinks or source runtime fallback:

```sh
npm install --prefix out/issue-781/public-consumer-fresh --ignore-scripts --no-audit --no-fund --save-exact \
  @poe-platform/safe-bash@0.1.695 @poe-platform/safe-fs@0.1.695 @poe-platform/safe-js@0.1.695
export SAFE_BASH_PYTHON_CONSUMER_ROOT="$PWD/out/issue-781/public-consumer-fresh"
mkdir -p out/issue-781/runtime-public-fresh
export TMPDIR="$PWD/out/issue-781/runtime-public-fresh"
export SAFE_FS_EXPORT_WORKER_DIR="$PWD/out/issue-781/export-public-fresh"
node --experimental-strip-types --test packages/safe-bash/tests/integration/python-object-io-781.test.mjs
```

Public mode uses installed runtime APIs and public conformance helpers; the new
measurement/control helpers and R2 fixture remain explicitly candidate-owned test
instrumentation, identified in input receipts. It is not a claim that the new
helpers already have published package exports.

Focused checks:

```sh
node_modules/.bin/vitest run packages/safe-fs/tests/object-io-*.test.ts \
  packages/safe-fs/tests/object-publication-staging.test.ts \
  packages/safe-fs/tests/object-publication-descriptors.test.ts
npm run typecheck --workspace=@poe-code/safe-fs
node --test packages/safe-bash/tests/integration/python-object-io-781.tooling.test.mjs
```

## Handoff and next qualification

Keep full results, failed/red/green logs, exported artifacts and patch/SHA receipt
under owned `out/issue-781`; purge transient Miniflare databases and incomplete
installs after use. A disk-full interrupted run timed out and produced no qualified
export; do not count it as a pass or use its truncated diagnostic as a final receipt.

Main must register the integration fixture and execute the exported protocol on
a genuinely hosted Worker with its new owner-attested bucket. It must stream/hash
the final canonical records, enforce final-summary gates, and report hosted
phase/request observations separately from these local samples. No bounded
batching/read-ahead change is justified or implemented by this worker; investigate
it only with concrete cross-layer measurements while preserving conditional
publication, retained readers, quotas, permissions and cancellation boundaries.
