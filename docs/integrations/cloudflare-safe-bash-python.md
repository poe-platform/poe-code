# Cloudflare and standalone safe-bash Python

## Current embedding status — September 17, 2026

The standalone `@poe-platform/safe-bash` package publishes the opt-in
`pythonCommands` plugin, `runPythonWorker` runner and `createNodePythonWorker`
endpoint. The older absence review below describes commit `937588145`, not the
current API. See the [standalone setup guide](../../packages/safe-bash/docs/pyodide.md)
for installation, public imports and an executable example.

The qualified convenience host is a **dedicated Node interpreter thread running
trusted Python**, with explicitly supplied **Pyodide 314.0.6 / CPython 3.14.2 /
wasm32 ABI 2026_0** assets. The fresh packed-package checks use Node 22.22.0;
earlier public-runtime records use Node 22.23.2. `agentCommands()` does not register
Python automatically. Each command owns a fresh interpreter; the application
supplies the canonical asynchronous filesystem rather than mirroring its workspace
into interpreter MEMFS.

Published `0.1.653` includes the standalone runner-resolution fix (#745), quota
descriptors (#748) and typed host diagnostics (#752). GitHub scoped release
`35247726840` succeeded, and all three scoped packages were verified on npm.
The separate `poe-code` CLI release is tracked independently; candidate CLI
tarball tests do not establish CLI registry publication.

### Three different execution models

| Model | Current status |
| --- | --- |
| Dedicated Node `worker_threads` interpreter | Implemented; synchronous guest calls wait for asynchronous host replies using shared memory. Requires `trustedPython: true`; not an untrusted-code sandbox. |
| Dedicated Web Worker interpreter | The runner protocol and historical fixtures exist, but require a separately scheduled interpreter, compatible assets and browser cross-origin isolation. This is not a deployed Cloudflare Worker service. |
| Existing workerd isolate with JSPI | Requested in #746, not implemented or qualified for Python. JSPI suspension at I/O boundaries is different from a thread and does not preempt CPU-only loops. |

The September 17 issue #746 probe reports that workerd exposes
`SharedArrayBuffer`, `Atomics` and JSPI primitives, while importing
`node:worker_threads` fails and `Atomics.wait` is rejected in that context. Its
small Wasm async-import probe passed; that does **not** qualify the pinned Python
build, native filesystem callbacks, local imports or C-extension paths. Do not
infer that all shared-memory/JSPI APIs are absent, or that merely placing this
Node endpoint in a separate Cloudflare deployment makes it work. The ordinary
shell's `workerd` export condition is not a Python executor.

### Filesystem, packages and lifetime

Ordinary Python file opens currently require canonical retained `fs.open`
handles. A `readFile`/stream-capable backend alone is insufficient. The #748
implementation adds quota-checked retained descriptors, with real Node document
creation/reopening and ENOSPC recovery through quota and delayed-quota views.
Immutable flat object stores (#747) and descriptor-safe `TemporaryDirectory`
cleanup (#749) remain required failing workflows. Memory and delayed-memory
successes are not remote-storage, physical-memory or full POSIX guarantees.
Readonly/mount layers must retain their authority; never unwrap a quota view or
substitute recursive path deletion for retained directory operations.

The host owns runtime installation and its adjacent Wasm, standard-library ZIP,
lock/native package assets. Pin and authenticate those bytes before evaluating
or decompressing them; a URL is not integrity evidence. The package environment
is currently plugin-owned; injected artifact caches may persist bytes, but
independent writers need external serialization. Reusing cached wheels does not
reuse an interpreter. Host-owned shared environments and conditional manifest
publication are tracked in #751. The default cache limit is 128 MiB per plugin,
not a bound on interpreter memory, artifact expansion or total application use.

Await command completion and `shell.dispose()`. Node endpoint termination can
interrupt its interpreter, including CPU loops; cooperative host filesystem
cleanup must still settle, and acknowledged writes are not rolled back. Per-plugin
admission is not application-wide admission. Untrusted execution with enforceable
CPU/memory/egress limits remains #750, and typed sanitized host diagnostics remain
#752. Do not forward arbitrary loader errors, credential-bearing URLs, source,
environment or file contents to agents or telemetry.

### Verification and upgrades

The [maintained packed consumer](../../packages/safe-bash/tests/integration/pyodide-runtime/public-package.test.mjs)
executes public imports, inline Python, binary I/O, a pipeline and awaited
termination. The [public runtime tests](../../packages/safe-bash/tests/integration/pyodide-runtime/package.json)
cover command/document/lifecycle cases; provisioning is separate from test
execution. Their required TODOs remain failures, not passing support claims.
The [delivery record](../plans/python-standalone-runtime-issues.md) distinguishes
candidate evidence from registry publication.

For upgrades, pin the runtime ABI and native package inventory, retain the
previous immutable artifact/assets/cache manifest, rebuild and rerun affected
public tests before rollout. The host owns asset hosting, authorization, cache
writer coordination, admission and teardown. No current Python workerd adapter,
disposable deployment, upload-size/memory qualification, or exercised Cloudflare
upgrade/rollback is claimed. A deployed service boundary alone does not establish
independent scheduling, preemption or confinement.

## Historical absence review — commit `937588145`

The following record is preserved unchanged apart from this heading. Its use of
"current", missing-API statements and commands refer to that historical review.
They do not override the implemented Node API and limitations described above.

Status: **unavailable / production qualification blocked**.
The [current public user edge review](../plans/cloudflare-user-edge-review-937588145.md)
at `937588145` records seven unavailable Python routes, concurrent absence,
shell recovery and repeated disposal against 2,372 hashed observed source/build
inputs. Zero production contracts pass. No rebuild or source-to-build
reproducibility claim is made. Independent review verified every inventoried hash and reproduced absence;
absence validation cannot substitute for production acceptance. Older reports
are historical evidence. No existing application Worker has been integrated
or modified.

## Embedding in an existing JavaScript Worker

The declared architecture keeps Pyodide inside the caller's JavaScript Worker.
The caller must inject a trusted executor and its authorized filesystem into
public safe-bash composition. Portable command policy must stay separate from
Node execution transport and Cloudflare JSPI suspension. The application owns a
borrowed provider; disposing one shell must not cancel sibling invocations or
retire an application-owned provider. Invocation resources need cleanup registered
before acquisition and admission, with idempotent awaited settlement.

That Python injection API, its Worker implementation and `src/sdk/bash.ts` do
not exist here. There is no runnable Python embedding example or installable
adapter to recommend. Current `poe-code/safe-bash` has a `workerd` condition for
ordinary shell code; this is not a Pyodide executor. Do not use the AI Gateway
Cloudflare provider as an execution adapter. To implement the embedding, first
supply the original Python/Node implementation and the passing lifecycle gate,
then verify the exact public injection signature and SDK parity with a built
consumer before publishing an example. No application bindings, routes or Worker
code should be changed as part of this review.

## Packages and assets

The exact qualified Python package set in this checkout is **empty**. Pyodide,
CPython and a native-package manifest have no reviewed pins or runtime assets.
XLSX, DOCX and PDF generation/reopening are all unqualified. Historical selected
library tests are not a supported package inventory; `safe-python` is a separate
interpreter and does not qualify this adapter.

The existing playground produces Vite static files under
`packages/safe-bash-playground/dist/site` through `scripts/build.mjs` and the
virtual safe-bash kernel build plugin. These files provide ordinary shell/regex
execution, with no injected Python runtime. A future adapter must inventory and
hash its generated JavaScript, WASM, runtime archives, wheels, lock/native
manifest and any static hosting assets. Distinguish Worker upload bytes from
externally hosted assets; pin and authenticate every executable dependency
before evaluation/decompression. Unknown native dependencies and missing or
corrupt manifests must fail closed through the public API, with recovery tested.
No filename or URL identity alone establishes integrity.

## Filesystem and cancellation contract

The caller's canonical asynchronous safe-fs backend must remain authoritative for
content and metadata operations. Interpreter MEMFS mirroring and copy-back do
not qualify this contract. Shared canonical files are intentionally accessible
within the caller's authority; interpreter-private state and handles must not
leak between invocations. Forward signals and actual provider error/identity
semantics; lexical path normalization does not establish symlink/mount confinement.
A successful in-memory write does not establish durable persistence. The actual
application persistent backend, consistency/durability contract and maintained
emulated integration route are unidentified. Concurrent writes, partial writes,
close/flush failure, stale metadata, rename/unlink with live descriptors, timeout,
quota and cancellation acquisition behavior all require that backend's evidence.

JSPI suspends Python during asynchronous I/O; it does not independently preempt
synchronous CPU loops in the same Worker. Cooperative cancellation cannot undo
acknowledged writes or forcibly stop opaque host work. Stronger mandatory
termination guarantees remain blockers until a supported mechanism is verified;
they must not be redefined as an experimental subset. Python cancellation is
unimplemented here. The browser's dedicated shell worker has an external
five-second supervisor; it includes startup, drains admitted filesystem cleanup
and preserves acknowledged writes. That shell behavior is not Python or
Cloudflare cancellation evidence. Browser Python Stop/reset, delayed replies,
navigation and CPU-loop termination remain unqualified.

## Deployment and operations

Current adapter upload size, memory/CPU use and existing application headroom are
unmeasured. The historical prototype reported 5,110.27 KiB gzip, not the current
adapter or available application budget. Local workerd and deployed public
adapter validation are blocked. Referenced disposable-target provenance/guards
are absent; no API call, credential inspection or deployment occurred in this
review. Credential expiry is unknown. Existing application integration is
explicitly unperformed.

Use only sanitized status codes, phase timings, admitted/pending/closed resource
counts, bounded memory observations and build/runtime identifiers in telemetry.
Do not log user Python source, filesystem bytes/paths, environment, credentials,
authorization headers, query tokens or raw host exceptions. Stable failure classes
should distinguish integrity/initialization, saturation, quota, storage/ambiguous
commit, cancellation and runtime traps. Synthetic secret canaries must verify
these diagnostic boundaries under success and every supported failure; no such
runtime qualification has passed here.

## Reproducible build, upgrade and rollback gate

Before implementation qualification, freeze source revision, lockfile, toolchain,
runtime/package pins and input hashes. After admission, use the maintained
selected workspace build closure, public consumers and affected unit routes:
`npm run build:workspaces -- --workspace=virtual-bash`,
`npm run typecheck:consumers --workspace=virtual-bash` and
`npm run test:unit --workspace=virtual-bash`. For browser changes use
`npm run test:unit --workspace=safe-bash-playground` and
`npm run build:workspaces -- --workspace=safe-bash-playground`.
Use the actual affected lint declarations; shared infrastructure changes require
the repository's full maintained routes. Register integration inputs by literal
path in `packages/safe-bash/scripts/integration-inputs.test.mjs`.

Build twice from identical clean inputs and compare normalized emitted asset
inventories/hashes, documenting any nondeterminism. Run the manual local workerd,
Node comparison, actual-backend/load and browser QA procedures linked from the
checklist. Inventory each dependency's exact version, license, redistribution
notices, transitive native modules and asset hashes; validate package allowlist
and manifest failure before admitting an upgrade. An empty adapter inventory is
not a completed license audit.

For each runtime pin upgrade retain the previous accepted immutable artifact and
manifest, review upstream compatibility/security changes, rebuild dependencies,
rerun every affected public contract and independently review the same final
artifact. Rollback restores that complete previously accepted artifact/pin set,
including static assets and manifest, then repeats public smoke and integrity
checks. Do not mix versions or assume persisted files are backwards compatible;
check the actual storage/document format contract before rollback. There is no
accepted artifact, verified upgrade or exercised rollback yet. These procedures
remain required checks, not claims of reproducibility or operational readiness.
