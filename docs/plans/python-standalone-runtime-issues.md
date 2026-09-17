# Python standalone runtime issue delivery

## #745: package-relative Node worker entrypoint

The published `@poe-platform/safe-bash@0.1.652` endpoint resolves a
`poe-code` export that is absent from a standalone installation. On September 17,
2026, the maintained public-package regression reproduced `ERR_MODULE_NOT_FOUND`
from `createNodePythonWorker` using Node 22.22.0 and Pyodide 314.0.6 in a fresh
installation containing only the published shell and explicitly installed runtime.

Resolve `worker.js` relative to the endpoint module. Both the standalone packager
and the retained CLI exports preserve this sibling layout. No CLI dependency or
implicit runtime installation is added.

### Validation recipe

Build the selected `@poe-platform/safe-bash` workspace closure, package it through
`scripts/package-safe.mjs`, and install the resulting tarball into a fresh directory
with pinned `pyodide@314.0.6`. Run:

```sh
SAFE_BASH_PYTHON_CONSUMER_DIR=/absolute/fresh/consumer \
  npm --prefix packages/safe-bash/tests/integration/pyodide-runtime run test:standalone
```

`SAFE_BASH_PYTHON_CONSUMER_DIR` is required and names the installation directory.
`SAFE_BASH_PYTHON_PACKAGE` defaults to `@poe-platform/safe-bash`; set it to
`poe-code` to exercise the retained CLI re-exports in a separately installed CLI
artifact. The test resolves all APIs through public exports in the consumer
process, checks that standalone consumers cannot resolve `poe-code`, executes
inline Python, binary canonical filesystem I/O and a shell pipeline, and verifies
that endpoint termination has completed before each command settles and after
shell disposal. It performs no provisioning or downloads.

### Verified candidate

The generated standalone `0.1.653-issue745` tarballs and a separately packed
`poe-code@0.0.0-dev` both pass the maintained public-package test with Node
22.22.0 and Pyodide 314.0.6. Each profile executes three real interpreters and
checks an immediately terminated startup probe. Focused Python unit tests pass
146/146; the maintained test inventory passes 109/109. The selected seven-workspace
build closure and root bundling suffix pass. Guarded ESLint reports zero errors
and two warnings outside the changed files. No full local unit suite was run.

The native subprocess test must run where child output can be captured: this
session's filesystem sandbox lost child stdout, producing an invalid test-harness
failure; rerunning the same fixture with approved native execution passed. The
original published-package missing-runner failure remains separately preserved.

This fixes packaging only. Cloudflare execution, untrusted-code confinement,
quota-backed descriptors, retained directory operations, shared package caches,
diagnostics and documentation requests #746–#753 remain separately tracked.
