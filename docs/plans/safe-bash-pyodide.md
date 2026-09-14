# Python in safe-bash

Status: open; architecture admission requires real-runtime evidence.

## Required behavior

Provide python/python3 running ordinary synchronous Python through pinned
Pyodide: scripts, modules and libraries, argv, incremental byte streams, and the
caller's canonical filesystem. Do not substitute shell.exec, whole-tree staging,
or a replacement MEMFS. Preserve filesystem policy and retained descriptors.

## Admission and implementation sequence

1. Read shell invocation, SafeJS integration and canonical safe-fs contracts.
2. Run an explicit integration experiment with an actual pinned Pyodide release.
   Exercise a custom Emscripten mount whose synchronous callbacks rendezvous with
   an asynchronous service on a different thread. Also evaluate supported stack
   suspension and deployment alternatives against the shipped runtime.
3. Prove open/pathlib/os/zipfile/tempfiles/imports, random access and immediate
   shared-file visibility on memory and a delayed asynchronous backend.
4. Prove incremental stdin/stdout/stderr with bounded shell pipes, including
   cancellation during blocked I/O, without blocking the backend service thread.
5. Map every filesystem method and capability, identity, mounts, read-only policy,
   quotas, operation budgets and resource cleanup; record concrete gaps in
   packages/safe-bash/docs/pyodide.md. Unsupported guarantees must be refused.
6. Only after admission, write failing fast unit tests, implement the command and
   bridge, then verify the real runtime through integration tests. Keep runtime
   downloads and slow real-runtime work outside ordinary unit discovery.
7. Run maintained focused checks and independent stress verification. Leave the
   feature open if contract preservation cannot be established.

## Ownership

- Root: coordination, architecture decision, package/public wiring if admitted.
- runtime: pinned runtime and filesystem integration experiment.
- pipes: independent streaming/cancellation integration proof.
- contracts: complete contract/deployment mapping and pyodide.md.

No README edits. No commit or release is claimed by this plan.

## Architecture gate outcome

The feature remains open. No production command or public runtime API was added.
Pinned Pyodide 314.0.6 / CPython 3.14.2 proves that a worker rendezvous can run
ordinary synchronous Python against immediate and delayed canonical filesystem
operations. Four incremental pipe/cancellation tests pass; blocked filesystem
read cancellation also passes. The final mount regression run has ten passes
and two failures: absolute canonical symlinks and scoped filesystem identity.

Plain mount callbacks are insufficient for atomic open; experimental pinned
FS.open interception and retained metadata hooks resolve those cases. Stock
stat ABI conversion also narrows metadata, and Node guest JavaScript interop
exposes ambient host capabilities. Root namespace relocation was attempted and
still fails on cached runtime-library paths. Full preservation is not established;
these results do not establish impossibility for every custom runtime/deployment.

The next implementation gate requires complete canonical namespace routing,
scoped identity translation, truthful stat ABI handling, and a qualified host
capability boundary. Only then should command registration, argv/module modes,
library deployment and full shell lifecycle/output-budget integration proceed.
Exact experiments, deployment alternatives and capability mapping are recorded
in packages/safe-bash/docs/pyodide.md. Real-runtime failures remain executable
opt-in integration assertions, not waived passes or default slow unit tests.
