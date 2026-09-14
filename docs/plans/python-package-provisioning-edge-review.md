# Python package provisioning user edge review

This review exercises the existing implementation against the original package
provisioning request. Use the pinned runtime and verified package matrix in
`packages/safe-bash/docs/pyodide.md`. Preserve existing work and READMEs.

## Execution plan

1. Run existing fast Python and root CLI/SDK tests before changes.
2. Review installer failure cleanup, requirements parsing, cache integrity,
   cancellation and publication. Reproduce each defect with a failing test using
   mocked transport and in-memory storage before editing production code.
3. Separately execute real Pyodide package installation, document workflows,
   package data, local modules and wheels, dependency resolution, offline reuse,
   interpreter isolation, cancellation/retry and negative inputs. Extend coverage
   for requirement markers, optional dependencies and paths containing spaces.
4. After runtime checks finish, build the selected workspace closure and run
   maintained typechecking. Do not replace imported dist artifacts while workers
   are executing. Run guarded lint and rerun the affected fast tests.
5. Inspect screenshots of the actual CLI installer help and offline import.
   Record scoped evidence and remaining limitations separately from delivery.

## Baseline, 2026-09-13

- Python command, provisioning and public export unit checks: 106 passed.
- Root CLI, SDK and export checks: 18 passed.
- Existing implementation and unrelated edits were already present in the
  working tree. This review does not attribute those changes to itself.

## Confirmed defects

- Cancellation during asynchronous cache reads or writes could still publish an
  environment manifest, publish an artifact URL record, or return successful
  replay. Cancellation from a cached-progress callback also returned success.
  Signal checks now follow those suspension and callback boundaries.
- Cancellation while an authorizer returned denial lost the original abort
  reason; a cancelled redirect response could also call the next authorizer.
  Checks now preserve cancellation and still dispose the response.
- Cache implementations returning mutable buffers or retaining `set` arguments
  could change bytes after authentication but before `package-read`. Both cache
  boundaries now preserve independently owned artifact bytes.
- A lent manifest buffer could change during requirements-file reads and pair
  old requirements with a newer conflict token. Preparation now decodes that
  manifest once and retains the same immutable string for both uses.
- Failed micropip bootstrap left the package download callback enabled. Cleanup
  now includes bootstrap and partial callback setup. A real-runtime rerun found
  that deleting unset Pyodide globals masked the original integrity error;
  cleanup now deletes only globals successfully installed.
- Real Pyodide reported success when an extra was added to an already installed
  local wheel, but its optional dependency was absent. The installer now combines
  active requested extras before passing requirements to micropip.
- A second wheel requesting an extra on an already installed dependency also
  reported success without installing that extra's dependency. Resolution now
  follows active extras through `Requires-Dist` metadata until the dependency
  set is complete, using micropip for installation and refusing version conflicts.
- Real Pyodide also accepted a raw version-2 local wheel in an environment pinned
  to version 1. Requested versions must be validated against the resulting
  environment before its manifest is committed.
- Converting wheel roots to named requirements initially bypassed micropip's
  desktop-wheel check for an already locked name/version. The retained runtime
  negative case caught this regression; explicit URL roots now undergo wheel
  compatibility admission before resolution.
- An alternate-path corrupt wheel with an already installed name/version could
  also report success. Direct URL admission now reads and validates the archive
  through the supported installer and integrity-controlled transport before
  accepting a satisfied package name.

Cache and cleanup defects were reproduced by failing fast regressions before fixes.
Unit tests use mocked transport and memory-only storage. Runtime failures and
fixes are measured separately; the cleanup regression was strengthened to model
Pyodide's actual missing-global deletion behavior. Extras and raw-wheel version
defects were reproduced by failing real-runtime regressions before code changes.

## Final verification

- Fast Python command, provisioning and public export checks: **118/118 passed**
  in 0.73 seconds, with mocked transport and in-memory storage.
- Root CLI/SDK/export checks: **18/18 passed**.
- Real Pyodide integration: **24/24 passed**, no failures, skips or cancellation,
  in **75.58 seconds**. Node **22.23.2**, Pyodide **314.0.6**, CPython **3.14.2**.
  The count includes thirteen workflow groups, ten independently reported
  negative cases, and their parent test.
- The runtime verifies the document profile and native dependencies, DOCX/XLSX/PDF
  round trips, packaged data, local modules, direct and transitive extras,
  requirements markers and paths with spaces, fresh-plugin offline reuse,
  interpreter-state isolation, failed-install preservation, cancellation/retry,
  malformed/incompatible wheels, missing packages, conflicts and integrity.
- `npm run build:workspaces -- --workspace=virtual-bash` passed the selected
  closure: **five builds**, from 74 discovered workspaces. This is not a claim
  that all workspaces were built.
- The explicit opt-in runtime inventory check and integration syntax check pass.
- Maintained package typechecking passed source/tests and all **26** current
  public-consumer groups; the three negative consumer fixtures failed compilation
  as intended. The initial check caught a new test spreading a class instance and
  losing its filesystem methods. The corrected test overrides the real in-memory
  instance's method and passed both the unit and complete typecheck reruns.
- The actual CLI imported `pypdf` from a copied persistent cache with offline
  mode enabled and no transport/origin configuration. Stdout was exactly
  `6.18.1` plus a newline; initialization/cache progress stayed on stderr.
  `cli-offline.png` was inspected and is readable.

Evidence is in `output/python-package-edge-review-20260913`: `unit.log`,
`runtime-final.tap`, `runtime-results-excerpts.txt`, `build.log`, and
`source-hashes.txt`. Earlier runtime failures in the excerpts file are labeled
as observed excerpts, not original complete TAP captures. The final full TAP
was captured directly. Product-source and runtime-test hashes were unchanged
after runtime and build. `runtime-source-hashes.txt` retains the initial unit-test
fixture binding; `source-hashes.txt` includes the subsequent type-only fixture
correction.

- Guarded `npm run lint:eslint` completed successfully: **0 errors**, **12 warnings**
  in the unrelated `.cache/pptx-usage-review/example.mts`. The final report is
  retained in `lint.log`; `git diff --check` also passed.
- `npm run screenshot-poe-code -- ...` captured `pip-help.png`, which was inspected
  for readable supported/unsupported option documentation. Its normal preparation
  completed 73 declared build tasks uncached and the root bundle. The separate
  CLI offline screenshot used the screenshot helper without rebuilding.
- Final hashes still match the reviewed product source, runtime test and corrected
  fast tests after all verification and screenshot preparation.

## Scope and delivery

These are working-tree checks, not exhaustive proof of every possible input.
Browser deployment, document visual layout, XLSX formula recalculation,
cross-process concurrent cache writers and unrestricted guest-network isolation
are outside this review. The configured installation transport remains distinct
from guest networking. Full repository `npm test` was not run for this focused
package change. No README edits, commits, push, remote-main delivery or release
were performed.
