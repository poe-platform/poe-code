# Python package provisioning qualification

Run the opt-in real-runtime integration separately from fast unit tests. The
runtime prerequisite is the isolated installation described in
`packages/safe-bash/docs/pyodide.md`: Pyodide 314.0.6, CPython 3.14.2,
Emscripten 5.0.3 and wasm32 ABI 2026_0. Install that explicit prerequisite with
`npm ci --prefix packages/safe-bash/tests/integration/pyodide-runtime --ignore-scripts`.
This manual qualification may download package assets; normal unit tests must
use mocked transport and in-memory storage.

## Execute

1. Run
   `node --import tsx --test packages/safe-bash/tests/integration/pyodide-runtime/package-provisioning.test.mjs`.
   Keep the actual output, runtime version and any unavailable network prerequisites
   in the work report. A skipped or unavailable case is not a pass.
2. Verify a package-free shell command creates no interpreter and performs no
   package request. Verify ordinary unconfigured Python cannot silently fetch a
   missing import.
3. Install the pinned document profile through the supported package API. Run
   ordinary Python creating and reopening DOCX, XLSX and PDF files in canonical
   storage. Read python-docx's packaged default template through
   `importlib.resources`; importing the top-level module alone is insufficient.
4. Run another Python command in a fresh worker. Assert package versions and
   imports remain available while changed module/global state does not. Deny
   package transport during reuse and assert zero package requests.
5. Supply requirements from canonical storage and a compatible wheel from the
   same storage. Assert a canonical local Python module is imported without
   copying the user tree to the runtime. Repeat installation with the same pin.
6. Attempt a desktop native wheel, corrupt wheel, missing distribution and
   incompatible dependency constraints. Require a nonzero status and a specific
   diagnostic, and verify previously committed packages still import afterward.
7. Interrupt a package download, then retry. Confirm incomplete bytes are not
   published as valid cache entries; matching complete cached artifacts remain
   usable. A changed artifact or incorrect SHA-256 must fail integrity checks.
8. Check the documented pip subset against actual shell dispatch. Supported
   options must act; unsupported options must fail before claiming success.
   Verify requirements installation has the same dependency behavior as SDK
   configuration.
9. Exercise a denied package host and redirect destination under the configured
   transport policy. Observe byte progress during allowed downloads. Installation
   policy does not establish restriction of arbitrary networking from guest
   Python: keep those claims separate.
10. Run the changed CLI help through `npm run screenshot-poe-code -- ...` and
    inspect the screenshot for readable package options and progress output.

## Reporting scope

Record fast unit and real-runtime results separately. Identify actual cases
executed from this plan and leave remaining cases explicit. These checks do not
qualify browser deployment, DOCX visual layout, XLSX recalculation, unrestricted
Python network isolation, a commit, remote delivery or a release.

## Execution record, 2026-09-13

The preimplementation real-runtime run reproduced missing `docx`, `pypdf` and
`pip`; ordinary non-Python startup remained lazy. After implementation, the
suite passed 9/9 tests (eight assertion groups plus their parent), zero skips,
on Node 22.23.2, Pyodide 314.0.6 and CPython 3.14.2 in 35.7 seconds.
It executed profile installation and document round trips, package data, local
modules/wheels, requirements, fresh-plugin offline reuse, interpreter-state
isolation, negative wheel/package/version/option checks, cancellation during
the actual six wheel response followed by retry, and cache-byte tampering.
These are working-tree results. No browser deployment or visual document layout
was evaluated by this Node test.

An expanded rerun adding a transitive dependency-conflict wheel overlapped a
workspace build. Its initial document-profile group passed, but later workers
could not import the temporarily absent `packages/safe-js/dist/safe-fs-core.js`.
That run is a failed prerequisite-race result, not passing runtime evidence.
Run this suite after the maintained workspace build completes, never concurrently
with a build that replaces its imported artifacts.

The expanded suite subsequently passed **10/10**, zero skips, in **54.1 seconds**
after the workspace build completed. It additionally verifies a real matching
native lxml wheel supplied through canonical storage, a local wheel whose
transitive dependency conflicts with the installed profile, refusal of
`--no-index`, and offline reuse from a canonical cache directory in a fresh
plugin with no transport configured.

Its Python command sources, test, runtime lock and runtime WASM were hashed before
and after execution and were unchanged. The source manifest SHA-256 is
`36188bf8751e0c27b9690c051a5a549bb0548c7e8e0ee9fc46b341697a851bd0`.
The manifest hashes the UTF-8 JSON array of `[repository-relative path, SHA-256]`
pairs, sorted by path, for all `.ts` files immediately under
`packages/safe-bash/src/commands/python`, this integration test, and the isolated
`node_modules/pyodide/{pyodide-lock.json,pyodide.asm.wasm}`. It is a scoped
working-tree input binding, not the hash of the complete transitive build.
The runtime index SHA-256 is
`3fdaef09e9e365c85e002737720f8d0ab8f278c1c244a2dde6a37663cf488ad4`;
the WASM SHA-256 is
`3a0a00dfeaa348ac20f9ef09904233d32d33f644339662d4af368f8a2010f37a`.

After the installer logging/progress corrections, the final rerun passed
**10/10**, zero failures or skips, in **43.4 seconds**. Its same scoped manifest
was unchanged before/after and has SHA-256
`a2823cfb893696be402eef82216023b5ac1b60afce003b9ecdd13203d6f62e83`.
This final run includes all nine assertion groups described above. The opt-in
inventory check and JavaScript syntax check also passed independently.

## Root integration verification

The completed working tree passed 106 fast Python command/provisioning/public
tests and 18 root CLI/SDK/export tests. The existing product-worker runtime suite
passed 17/17 in addition to the 10/10 package provisioning suite above.
`npm run build` completed all 73 declared workspace builds and the root schema,
TypeScript, wrapper and bundle stages. The workspace without a declared build
was reported as such, not counted as a pass.

Maintained safe-bash source/test typechecking and all 26 consumer groups passed;
the three expected negative consumer checks failed compilation as intended.
Root `npm run lint:types` passed. Guarded `npm run lint:eslint` completed with
zero errors and 12 warnings in the unrelated cached PPTX usage example.
These are focused/runtime/type/build checks, not a claim that full `npm test`
was executed.

The actual built CLI installed `pypdf==6.18.1` into an explicit rooted-real
canonical cache and imported it from a subsequent Python invocation. A new CLI
process with `--python-package-offline`, the same cache and no transport/origin
configuration printed exactly `6.18.1` followed by a newline on stdout.
Initialization and cache progress remained on stderr; runtime loader console
messages were absent. Evidence is under
`output/python-package-cli-20260913/offline.{stdout,stderr}.txt`.

Inspected screenshots:

- [CLI package options](../../screenshots/bash-help.png), captured with
  `TURBO_FORCE=true npm run screenshot-poe-code -- bash --help`.
- [Built CLI offline reuse](../../screenshots/python-package-offline.png),
  captured with the screenshot helper against `node dist/bin.cjs` after the final
  build. It shows cache progress and the successful import version.

READMEs were not edited. No commit, push, remote-main verification or release
was performed for this request.
