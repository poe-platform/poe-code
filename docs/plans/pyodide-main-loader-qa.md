# Python main-module and stream user QA — 2026-09-16

## Scope and execution plan

Read `pyodide-safe-bash.md`, root AGENTS.md and safe-bash AGENTS.md before
execution. Preserve the existing implementation and unrelated working-tree
changes. Test built public exports against matched native CPython 3.14.2 in
Bash; runtime/package provisioning remains separate from fast unit tests.

1. Run `npm run build` and wait for completion before final acceptance runs.
2. Provision the pinned Pyodide 314.0.6 document profile using the maintained
   `provision-public-runtime.mjs` command and an explicitly owned cache.
3. Add differential main-loader cases for both aliases in inline, explicit
   stdin, implicit stdin and file modes. Add text stream encoding/error policy,
   universal newline input and raw binary newline preservation cases.
4. Run the new checks before production changes. Compare raw stdout/stderr and
   statuses. Correct only reproduced differences, then rebuild and rerun.
5. Execute the entire maintained `test:python:integration` route with
   `SAFE_BASH_NATIVE_PYTHON` naming matched native CPython and
   `SAFE_BASH_PYTHON_CACHE` naming the provisioned cache. Request document
   capture with `SAFE_BASH_PYTHON_ARTIFACT_DIR`.
6. Run Python command units, integration inventory and focused ESLint. Unit
   verification must not provision assets or write host fixtures.
7. Reopen captured documents in independent host readers. Export representative
   DOCX and XLSX to PDF with LibreOffice, render them and the generated PDF to
   PNG, and inspect screenshots. Host rendering is external QA evidence.
8. Capture and inspect the built CLI's main-loader output with the maintained
   screenshot route. Record passes, failures, required TODOs and unavailable
   cases separately. Purge owned temporary evidence after inspection.

`/out` is read-only on this host (confirmed by failed directory creation), so
this run uses ignored checkout-local `out/pyodide-user-final` for temporary
logs, preprovisioned cache, artifacts and screenshots.

## Reproduced issue

The built public command reports `__main__.__loader__ is None` for inline and
stdin execution. Matched native CPython reports `BuiltinImporter`. Added
differential integration checks fail before the change; existing file-mode
`SourceFileLoader` behavior passes. The launcher now gives the new main module
CPython's builtin loader; ordinary file execution continues to assign its
source loader and runpy retains module/directory/zip handling.

## Acceptance limits

Required TemporaryDirectory descriptor cleanup on memory/delayed storage and
quota-backed descriptors remain explicit unfinished workflows. No weaker
path-based cleanup or quota bypass is introduced. Full canonical backend
fidelity, interactive terminals, native processes/threads, guest networking,
hard resource confinement and Cloudflare remain open. XLSX formula storage is
not recalculation; DOCX round trips are not Word-to-PDF support inside Pyodide.
No selected passing matrix establishes complete compatibility.

## Measured verification

Runtime: Node 22.22.2, Pyodide 314.0.6 / guest CPython 3.14.2; native
CPython 3.14.2 on macOS arm64 with Bash 3.2.57. Guest `emscripten`, 32-bit
pointers and empty `sys.executable` remain intentional platform differences.

| Check | Result |
| --- | --- |
| Normal `npm run build` after the launcher change | Pass, including workspace build and root suffix stages. |
| Loader baseline after the first complete build | Six failing alias/mode regressions; two passing file controls. |
| Complete maintained built-public integration route | 141 passes, three required TODOs, no unexpected failures/cancellations/skips. |
| Matched-native command portion | 120 passing entries, including 14 added loader/stream cases. |
| Real product-worker/stdio integrations | 45/45 pass. |
| Python command units | 145/145 pass; no runtime/package downloads. |
| Maintained integration inventory | 109/109 pass. |
| Maintained virtual-bash typecheck after build | Pass, including public consumers and expected negative profiles. |
| Focused ESLint and whitespace | Pass. |
| Independent host artifact checks | Both memory and delayed artifacts pass DOCX/XLSX reopening and independent PyMuPDF PDF extraction/resource checks. |
| Built CLI capture | Initialization and `BuiltinImporter` output inspected. |

The three TODOs concretely reproduce ENOTSUP for memory/delayed
TemporaryDirectory retained-directory cleanup and quota descriptor access.
The suite's zero exit status does not certify those required workflows.
Delayed document storage records 9,361 operations and zero retained handles.
Lifecycle checks cover composed authority and bidirectional effects, setup
failure/recovery, cancellation, output exhaustion, offline miss/reuse, integrity
failure and installation cancellation/retry.

An early full parity attempt overlapped generated-export replacement during
the first build and encountered missing generated modules; it is discarded
as runtime evidence. The focused pre-fix loader run and complete post-fix
acceptance run occur after their respective builds finish. Similarly, an
overlapping typecheck is superseded by the passing post-build run.

Host readers are separately provisioned with python-docx 1.2.0, openpyxl 3.1.5,
pypdf 6.18.1, PyMuPDF 1.28.2 and Pillow 12.2.0. The initial native openpyxl
reader lacked Pillow and omitted image loading; after provisioning that
prerequisite, both artifacts pass image/chart checks. This was a host QA
environment deficiency, not a reproduced guest defect. Formulas remain stored,
and data-only cells remain uncached after openpyxl edits.

Both generated PDF pages are rendered and inspected: Helvetica title/image on
page one and embedded-font text on page two. LibreOffice never reaches startup
(process sample remains at `_dyld_start`, 96 KiB footprint); the owned stalled
process is terminated. Fresh office conversion through LibreOffice is
unavailable in this run. Quick Look provides independent external previews;
it does not establish office rendering inside Pyodide or fidelity to Word/Excel.

Quick Look's DOCX screenshot shows the heading, table values, image and appended
edit. Its openpyxl thumbnail is cropped; inspecting the generated HTML in Chrome
shows values 7/3 and the blue bold header, but the preview assigns zero dimensions
to drawing/chart resources and displays the uncached formula as zero. Native
openpyxl confirms the stored formula and absent cache; preview zero is not
calculation evidence. Chart/image visual fidelity remains unavailable here.

Quick Look rejects the edited XlsxWriter workbook with
`OCPPackagePropertiesError: Could not find XML namespace`. A native-only
openpyxl workbook with `properties.creator = None` reproduces the same refusal.
Native reopening/saving of the guest workbook adds the default creator metadata
and then previews successfully. This validates an external renderer limitation;
it does not justify changing canonical storage or the Python runtime. The
original artifacts are preserved throughout qualification.

The initial built CLI screenshot uses `npm run screenshot` against
`node dist/bin.cjs`; the additional maintained `screenshot-poe-code` route
executes the same main-loader check after its normal predev build.
No commit, push, remote-main delivery or release is performed. Readiness remains
draft and finalization remains pending.
Both CLI captures are inspected. Owned renderer/browser processes are stopped
and this run's temporary evidence, reader environment and cache are purged.
