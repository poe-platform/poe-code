# Python filesystem user acceptance QA — 2026-09-16

## Scope and execution plan

Continue from [the current acceptance gates](pyodide-safe-bash.md), preserving
working implementation and all existing working-tree edits. Baseline HEAD is
`06fac91e776c2c56c8a1ad9036ebaca60f55d67a`. This run uses Node 22.22.2,
Pyodide 314.0.6 and CPython 3.14.2. Full compatibility remains an open target.

1. Read repository/package instructions, canonical filesystem and descriptor
   contracts, Python bridge contracts and the measured runtime decisions.
2. Run Python command units and canonical Python/retained quota-resize units.
3. Execute the current product-worker and bounded-stdio integration suites.
   Exercise partial reads/writes, append/exclusive acquisition, seek/truncate,
   descriptor aliases, unlink/replacement, errors, mounts, readonly storage,
   CPU/import/blocked-I/O cancellation and concurrent pipelines.
4. Check bridge admission independently using in-memory backend doubles.
   Reproduce any issue with a failing test before production changes.
5. Build the explicitly selected `virtual-bash` dependency closure using
   `npm run build:workspaces -- --workspace=virtual-bash`. Wait for completion
   before starting rebuilt-public verification.
6. Run delayed ordinary-script proof and public lifecycle checks. Provision
   the pinned document profile explicitly using `provision-public-runtime.mjs`
   with a cache under `out/pyodide-edge-followup-cache`. Run public documents
   and lifecycle with that offline cache; count failing TODOs separately.
7. Run public command parity against the installed native CPython 3.14.2 at
   `/Users/kjopek/.local/share/uv/python/cpython-3.14.2-macos-aarch64-none/bin/python3.14`.
8. Check focused ESLint, safe-fs typechecking, maintained integration membership
   and whitespace. Capture and inspect the built CLI reading/writing ordinary
   shared files under `out/pyodide-directory-qa`.
9. Record measured results and purge this run's logs, cache and screenshot.
   Do not edit README or change draft readiness/pending finalization.

## Validated correction

`PythonFileSystem` forwarded `readdir.maxEntries` but returned an oversized
reply when a backend ignored the requested limit. The new in-memory regression
returns two canonical entries to a service configured for one. Before the fix,
the test fails because the promise resolves instead of rejecting. The service
now rejects the oversized reply with `EFBIG`; the same listing succeeds when
the configured limit is exactly two. Application contents remain intact.

The check lives in safe-fs and introduces no runtime/provider branching,
mirroring, buffering, descriptor emulation or root changes. The contract now
states that the reply check cannot bound allocations already made by an
uncooperative backend.

A second red regression verifies the directory-enumeration contract's
cancellation precedence: a backend aborts with `false` while returning an
oversized listing. The initial guard incorrectly selected `EFBIG`. A post-await
cancellation checkpoint now preserves the exact abort reason before inspecting
reply cardinality. Both regressions pass.

## Measured results

- Python command units: 144/144 pass.
- Canonical Python and retained quota-resize units after the final correction:
  120/120 pass across five files; both new regressions were red before their
  respective production edits.
- Additional canonical descriptor contracts, memory/wrapper, append-position and
  truncating-open units: 163/163 pass across five files.
- Product-worker and bounded-stdio integration: 45/45 entries pass, zero skips,
  failures or TODOs. This started before the correction; it is baseline runtime
  coverage, while rebuilt-public results qualify the rebuilt boundary.
- Explicit maintained workspace closure: all seven declared build tasks pass.
  The same closure also passes after the final cancellation checkpoint.
- Delayed ordinary-script proof against the rebuilt filesystem bridge: pass,
  166 operations, covering ordinary open/pathlib/os/zipfile, seek/tell,
  temporary files, imports, read-after-write and retained rename identity.
- Selected rebuilt-public lifecycle: 13 passes, one failing required quota
  TODO, zero unexpected failures or skips.
- Matched native CPython 3.14.2 public command parity: 56/56 pass, zero skips,
  failures or TODOs.
- Maintained integration membership: 109/109 pass.
- Complete public document and lifecycle run: 18 passes and three failing
  required TODOs, zero unexpected failures or skips across 21 entries. DOCX,
  XLSX and PDF assertions pass on memory and delayed storage; safe
  `TemporaryDirectory` cleanup fails in both profiles, and quota reads fail.
  This run precedes the final cancellation-precedence checkpoint; the final
  checkpoint is separately covered by the new in-memory regression.
- Final rebuilt delayed ordinary-script proof passes again (166 operations).
  Final blocked filesystem-read cancellation probe also passes: the retained
  handle closes and the parent event loop stays responsive.
- Focused ESLint, safe-fs typechecking and whitespace checks: pass.
- CLI screenshot inspected: initialization progress and `canonical` output
  render correctly; the rooted shared file contains `canonical`, status zero.
  The root CLI bundle was an existing build, so this is visual smoke evidence,
  not qualification of the changed directory reply boundary.

## Remaining required gaps

The rebuilt-public quota test reproduces `ENOTSUP` at
`Path('/quota/input').read_text()`. Generic quota descriptor acquisition remains
explicitly unsupported. Supporting writable quota handles requires retained
identity and alias-aware growth admission coordinated with existing quota
mutations and resource retirement. Bypassing the wrapper or writing back by
pathname would violate the acceptance contract.

Retained directory descriptors and descriptor-relative operations, general
no-follow acquisition, complete backend fidelity, browser/Cloudflare deployment,
interactive TTY/native process/thread parity and hard resource confinement remain
unqualified or unsupported. This scoped correction does not close those gates.
No commit, remote-main delivery or release was performed.
