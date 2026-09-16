# Python filesystem user review

Review the optional Python command against the caller-owned filesystem, using
the pinned Pyodide runtime for ordinary scripts and in-memory doubles for fast
conformance tests. Preserve other working-tree changes. Do not edit README.

## Review steps

1. Read the filesystem, descriptor, Python and shell contracts and the measured
   decisions in `packages/safe-bash/docs/pyodide.md`.
2. Run canonical descriptor cases through the Python service and test delayed
   and partial transfers, retained identity, rename/unlink, flags, errors,
   metadata, readonly/mounted/quota refusal, bounds and cleanup.
3. Execute ordinary Python through the actual worker: local imports, script and
   module entry, binary streams, temporary files, seek/truncate, duplicate
   descriptors, sparse writes, symlinks and exceptions. Exercise bounded pipes
   and cancellation while I/O is blocked.
4. Reproduce newly found defects with failing tests before fixing them.
5. Build the selected `virtual-bash` workspace closure, check source and public
   consumer types, and run public export/browser bundle checks.

## Verified corrections

- The mount previously passed initial cwd directly to Emscripten, which could
  normalize symlink-sensitive components before consulting canonical storage.
  Resolve initial cwd using the caller filesystem's `realpath` first.
- A throwing worker unsubscribe callback prevented worker termination and
  filesystem cleanup. Settle subscription disposal, termination and service
  cleanup independently, retaining cleanup errors.
- Synchronous cancellation inside the worker factory or subscription still
  posted interpreter startup. Check cancellation after factory return and
  immediately before posting startup; retire the acquired worker.

Each correction has a regression that failed before the corresponding fix.

## Scope and observations

Shell constructor/exec cwd options already normalize paths lexically before
command dispatch. Therefore `Shell({ cwd: '/work/link/..' })` supplies `/work`
to commands even if `link` targets another directory. The Python mount cannot
recover that original operand. Its initial-cwd regression must preserve the raw
operand at the worker/command-context boundary; changing all shell startup
semantics is separate work. Python `os.chdir` still resolves through canonical
storage.

This review does not establish every possible edge case, arbitrary remote
backend behavior, complete C-extension compatibility, browser deployment or a
Python security sandbox. Unsupported canonical descriptor capabilities remain
refusals. The runtime and package assets remain explicitly host-provisioned.
No commit, push or release is part of this review.

## Check evidence

- Canonical descriptor and Python filesystem suites: 109 passed.
- Python command/worker/reply unit suites: 15 passed.
- Public exports and browser bundle suites: 41 passed.
- Pyodide opt-in inventory check: passed.
- `npm run build:workspaces -- --workspace=virtual-bash`: passed after fixes.
- `npm run typecheck --workspace=@poe-code/safe-fs`: passed.
- `npm run typecheck --workspace=virtual-bash`: passed, including 26 maintained
  consumer groups and expected negative-consumer failures.

Actual-runtime final results are recorded in the accompanying review update in
`packages/safe-bash/docs/pyodide.md`. Unit/bundle checks do not execute Python;
the explicit product-worker integration does.
