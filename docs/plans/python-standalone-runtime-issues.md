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

## #753: current standalone embedding documentation

Validated the stale claims directly: the Cloudflare guide described the Python
API as absent and the Pyodide setup denied standalone publication, despite the
published exports and #745 packed-consumer results. The current sections now
document the public standalone imports, opt-in trusted Node profile, exact runtime
pin, dedicated-thread versus same-isolate JSPI boundaries, and unresolved
filesystem/cache/resource/deployment requirements. The original absence review
and experimental evidence remain explicitly historical.

Extracted the exact new `python-example.mjs` fenced example from the Pyodide guide
and executed it in the fixed standalone tarball installation with Pyodide
314.0.6: exit zero, `hello from Python`, canonical memory-file write/read and
awaited shell disposal. No `poe-code` dependency is present in that consumer.
The guide deliberately warns that `0.1.652` has #745 and that source/candidate
verification is not registry publication. The release workflow on `9557d2469`
failed at the separate Pandoc bundle publication gate, so a fixed registry
version is not yet claimed. Installed-registry revalidation remains pending.

## #748: quota-backed retained Python descriptors

Eight initial focused tests reproduced the unconditional quota `open` refusal.
The wrapper now retains backend descriptors, shares write admission with its
existing mutation queue, and checks positioned/cursor/append/sparse growth against
fresh bounded logical namespace censuses. Complete retained identity is required
for writable regular files. Read-only access does not require a census. Quota
errors carry ENOSPC through mount/Python translation. Strong backend unlink is
forwarded without a weak rm fallback so named temporary files can clean up.

Independent review added 51 edge cases, finding three failures in two areas:
cancellation from an open-capability getter could still dispatch acquisition,
and delegated empty writes could be falsely charged as distant growth. Both were
fixed without weakening the regressions. A further mounted self-symlink regression
preserves exclusive creation's EEXIST precedence. Close does not wait for unrelated
later acquisitions; backend failures and falsey cancellation retain identity.

Real pinned Python quota lifecycle checks pass four tests. Quota and delayed-quota
document profiles pass their create/edit/reopen/stream workflows and leave zero
tracked open handles (10,141 delayed operations). Each still records a required
failing TemporaryDirectory TODO under #749; these two TODOs are not passes. Initial
document tests exposed the strong-unlink refusal before its fix. This is not
workerd, immutable-object-store, total-memory or cross-wrapper transaction proof.

The earlier 4,304-test safe-fs workspace run passed after allowing loopback sockets;
the sandboxed attempt had permission-denied network fixtures, not product passes.
Final expanded tests and installed-candidate qualification follow separately.

Final candidate: 4,357/4,357 safe-fs tests pass, strict workspace types pass,
the maintained integration inventory passes 109/109, and guarded ESLint reports
zero errors plus two unrelated warnings. The selected shell workspace closure,
root bundle and standalone packager pass. Fresh installed `0.1.653-issue748`
tarballs pass both memory and quota public consumer profiles, including named
temporary-file cleanup, 256-byte binary I/O, refused excess growth, pipelines
and awaited termination. The final built quota/delayed-quota document rerun
passes both parent workflows, retaining the same two explicit #749 TODOs.

Commit `433c66735` fixes the earlier Pandoc bundle-order gate. Its GitHub scoped
release then passed bundling but failed required package README checks for
Pandoc/PDF. Permission to add those READMEs has been requested; registry
publication is still pending, independently of this candidate's passing checks.

## Verified scoped publication — September 17, 2026

The README fix landed separately as `aee265445`. Scoped workflow `35247726840`
then completed successfully on that main commit. npm reports `0.1.653` for
`@poe-platform/safe-fs`, `@poe-platform/safe-js` and `@poe-platform/safe-bash`;
Safe Bash's `latest` tag and exact-version metadata were checked separately.
This publishes #745, #748, #752 and the #753 documentation correction. The
`poe-code` CLI release is still running separately and is not established by
the scoped package publication.
