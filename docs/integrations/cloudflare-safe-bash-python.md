# Cloudflare safe-bash Python integration boundary

Status: unavailable in the reviewed checkout; production qualification blocked.
The [current handoff review](../plans/cloudflare-adapter-handoff-current.md)
records fresh built-public-API observations at
`51ea26d96f61b74ffb0ef70aeaef48d5cc423d4e`, with a source/build byte inventory
and independent review. All production contracts remain blocked. The rechecks
below are historical evidence, not certification of a finished adapter.
The [current user edge recheck](../plans/cloudflare-user-edge-current-recheck.md)
binds fresh built-public-API observations to source and build hashes at
`bb272573292ee712a09c1c5fdb1516f7a655dc97`; it confirms availability failure,
not Python acceptance. Independent review confirms the same missing adapter.
See [the final requirement checklist](../plans/cloudflare-adapter-final-review.md)
for evidence identities and acceptance requirements. No existing application
Worker has been integrated or modified.

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
