# Pyodide user edge QA — 2026-09-16

## Scope and environment

Execute user-facing Python workflows against current built public exports, then
verify canonical file effects and resource retirement. Preserve the original
acceptance target in [pyodide-safe-bash.md](pyodide-safe-bash.md).

This is working-tree verification at HEAD
`06fac91e776c2c56c8a1ad9036ebaca60f55d67a`, with existing unrelated edits preserved.
Runtime: Pyodide 314.0.6, CPython 3.14.2, wasm32 ABI 2026_0, Node 22.22.2.
The native comparison uses CPython 3.14.2 on Darwin with Bash 3.2.57.
Only integration verification provisions real runtime/package assets; unit
fixtures remain in memory. README and production filesystem code are unchanged.

## Execution steps

1. Read the current plan, Python contract, safejs integration, shell stream
   types and canonical filesystem/descriptor documentation.
2. Run `npm run build` and wait for completion before invoking public suites.
   Build publication replaces output directories; concurrent integration runs
   can fail with missing modules and do not qualify the completed build.
3. Provision the pinned isolated runtime with the integration package's
   maintained `npm ci --ignore-scripts` route if unavailable. Run
   `provision-public-runtime.mjs` with an absolute `SAFE_BASH_PYTHON_CACHE`
   under the workspace's `/out` directory. This run's runtime was already
   present; the document package cache was provisioned explicitly.
4. Run `verify.mjs 0`, `verify.mjs 1`, `cancel-fs.mjs`, and
   `promise-callback.mjs` from `tests/integration/pyodide-runtime`.
   Use `node --import tsx` for source-based probes.
5. Run current `product-worker.test.mjs` and `stdio-proof.test.mjs` through
   `node --import tsx --test --test-concurrency=1`.
6. Set `SAFE_BASH_NATIVE_PYTHON` to the absolute matched-version executable
   and retain the preprovisioned `SAFE_BASH_PYTHON_CACHE`. Run the integration
   package's `test:public` route for command parity, documents and lifecycle.
   Count failing TODOs separately from passes even when the runner exits zero.
7. Run Python command unit tests through node:test/tsx. Run canonical Python
   filesystem, Emscripten translation and retained quota-resize tests through
   Vitest. Validate integration membership with
   `node --test packages/safe-bash/scripts/integration-inputs.test.mjs`.
8. Lint the changed public lifecycle test with ESLint and check the diff.
9. Capture the built CLI with the maintained `scripts/screenshot.ts` tool,
   using `node dist/bin.cjs bash -c 'python -c "print(42)"'`, an explicitly
   rooted `/out` directory, the pinned runtime URL and `--python-trusted`.
   Inspect the image. For integrity diagnostics, copy the provisioned cache into
   `/cli-cache/pyodide-314.0.6-cp314-emscripten-wasm32-v1` inside that root, damage
   one digest-keyed artifact, and repeat with `--python-package-profile documents
   --python-package-cache /cli-cache --python-package-offline`. Verify status 1,
   an explicit integrity-mismatch diagnostic and no user-code output. Use the
   built CLI directly to avoid an implicit predev rebuild during verification.
10. Record results below, preserve required open gates, and purge this run's
    temporary logs, screenshots and package cache after inspection.

## Measured results

| Scope | Result |
| --- | --- |
| Normal build | Pass before and after the fix. |
| Focused maintained workspace build closure after fix | Pass, seven declared build tasks. |
| Python command unit tests after diagnostics fix | 144/144 pass. |
| Canonical Python translation and retained quota-resize units | 121/121 pass across six files. |
| Current real product-worker and bounded-stream integration | 45/45 test entries pass; no failures, skips or TODOs. |
| Ordinary synchronous script | Memory and 1ms-delayed canonical storage both pass, 166 backend operations each; open/pathlib/os/zipfile, seek/tell, temporary files, imports, read-after-write and retained rename identity. |
| Blocked filesystem read cancellation | Pass: one retained handle closes and the parent service event loop remains live. |
| Promise-returning synchronous FS callback | Confirmed invalid on Node 22: supplied bytes are not read; supported suspension is unavailable in this context. |
| Integration membership | 109/109 pass. |
| Matched built-public command parity | 56/56 entries pass before the installer-only fix. |
| Built-public documents and lifecycle after fix | 18 passes, one failing quota TODO; zero unexpected failures/skips across 19 entries. |
| Changed-test lint and whitespace | Pass. |
| Maintained package typecheck | Pass for source/tests and maintained consumer/negative profiles; not runtime acceptance. |
| CLI screenshots | Inspected successful initialization/`42` output, status zero; rebuilt CLI's corrupted-cache run reports an explicit integrity mismatch, status 1, no user-code output. |

The added built-public test exercises absolute directory symlinks and two
interleaved append handles on memory and delayed storage. Writes reach the
canonical absolute target; append uses the current EOF even after a seek and
another writer; tell/read observe accepted bytes. After unlink and pathname
replacement, the held handle still reads/writes its original object, the new
pathname retains replacement bytes, and all handles close. Both profiles pass
without a production fix.

The historical experimental `mount-regressions.test.mjs` still fails its
absolute-directory-symlink case. The equivalent current built-public case passes;
that prototype failure does not reproduce a current product-worker defect.
Initial integration attempts made during a build, and unit files launched with
the wrong runner, were discarded as qualification evidence and rerun correctly.

## Required gaps remain open

The initial complete public run reported 73 passes, one unexpected failure and
one failing quota TODO, with no skips. Matched native command parity passed
56/56 entries, and both document profiles passed. The unexpected lifecycle
failure exposed micropip replacing a corrupted host-cache integrity exception
with a generic missing-package-metadata error. A new in-memory unit regression
failed before production changes. The installer now retains the original host
transport exception and restores it when installation fails, while preserving
callback/transport cleanup and preventing environment publication. Successful
installation behavior is unchanged. Targeted closure build and all 144 command
units pass after the change; repeated document and lifecycle verification
against rebuilt public exports reports 18 passes and one failing quota TODO.
The previously unexpected corrupted-cache diagnostic failure now passes.

The quota acceptance test concretely fails at
`Path('/quota/input').read_text()` with `ENOTSUP`. Canonical quota storage
intentionally refuses general descriptor acquisition. Its retained resize
route does not supply byte writes. A complete fix requires retained identity
and alias-aware growth admission for positioned/cursor/append writes, unlink,
replacement and retirement, coordinated with existing quota mutations. Neither
wrapper bypass nor pathname writeback preserves this contract. Refusal is
truthful, but the required Python quota/document workflow is unfinished.

This run does not qualify browser/Cloudflare deployment, all remote/overlay
backends, retained directory descriptors, general no-follow opens, interactive
TTY behavior, native subprocesses/threads, hostile-code confinement or hard
CPU/memory limits. It does not establish arbitrary document rendering,
conversion or formula recalculation. Preserve the plan's draft readiness and
pending finalization. No commit, remote-main delivery or release was performed.
