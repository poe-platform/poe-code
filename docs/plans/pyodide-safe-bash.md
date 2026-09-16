---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1
readiness: draft
tasks:
  - id: prove-python-runtime-and-filesystem
    title: Prove ordinary Python execution over the canonical shell filesystem
    prompt: >
      Read the current status and remaining acceptance gates in
      docs/plans/pyodide-safe-bash.md first. The optional Node Python command,
      canonical filesystem bridge, package provisioning, lifecycle controls and
      public integration suites already exist. Preserve working implementation;
      validate remaining gaps before changing code. Historical missing-adapter
      reports do not describe current main. The requirements below remain the
      acceptance target; implemented baseline statuses do not certify full
      compatibility or Cloudflare support.


      The required feature is python/python3 inside safe-bash, powered by
      Pyodide,

      behaving like Python launched from Bash: script files, modules, libraries,

      stdin/stdout/stderr, arguments and shared files. Python calling shell.exec
      is

      not a substitute. Read applicable AGENTS.md,
      packages/safe-bash/src/commands/

      safejs/, shell/types.ts, and packages/safe-fs/src/contracts/filesystem.ts,

      descriptor.ts and their documentation. Keep planning in docs/plans.

      Before committing to architecture, prove a pinned real Pyodide runtime can

      execute an ordinary synchronous script whose open(), pathlib, os, zipfile,

      seek/tell, temporary files and imports use an injected canonical
      FileSystem.

      The critical boundary is synchronous Python/Emscripten I/O versus
      Promise-based

      safe-fs operations. Investigate a custom Emscripten mount with a
      worker/RPC

      bridge, or supported stack suspension, and verify actual runtime support.

      Do not assume JS promises are accepted by synchronous filesystem
      callbacks.

      Keep the asynchronous backend service off any thread blocked waiting for
      it.

      Prove incremental stdin and output against bounded shell pipes without
      deadlock.

      Test a delayed asynchronous backend as well as memory, including
      cancellation

      while blocked, random access and read-after-write. Preserve operation
      budgets,

      read-only wrappers, mounts, quotas, identity and retained-handle
      semantics.

      No whole-tree copy-in/copy-out substitute and no requirement to replace
      the

      caller's filesystem with Pyodide MEMFS. Map every mandatory method and
      optional

      capability; decline unsupported optional guarantees truthfully.

      Record runtime/version, deployment requirements (including cross-origin
      isolation

      if required), supported execution contexts and remaining gaps in

      packages/safe-bash/docs/pyodide.md. Evaluate deployment alternatives
      explicitly;

      if full contract preservation is impossible, record the concrete blocker
      and

      leave this task open instead of silently narrowing the requirement.

      Use failing tests before production code and fast in-memory unit doubles;

      real-runtime experiments belong in integration verification. Do not edit
      README.
    status:
      implement: done
      test: done
  - id: prove-document-libraries
    title: Qualify Word, Excel and PDF libraries in real Pyodide
    prompt: >
      Read the current status and remaining acceptance gates in
      docs/plans/pyodide-safe-bash.md first. The optional Node Python command,
      canonical filesystem bridge, package provisioning, lifecycle controls and
      public integration suites already exist. Preserve working implementation;
      validate remaining gaps before changing code. Historical missing-adapter
      reports do not describe current main. The requirements below remain the
      acceptance target; implemented baseline statuses do not certify full
      compatibility or Cloudflare support.


      The priority is ordinary Python scripts invoked as python FILE inside
      safe-bash

      that use python-docx, Excel libraries and PDF libraries on the canonical
      shell

      filesystem. Read applicable AGENTS.md. Before broad implementation,
      qualify a

      pinned Pyodide runtime and exact package versions in a real browser
      worker.

      Load the matching Pyodide-built lxml and Pillow where needed, then install

      compatible pure-Python wheels through micropip with dependency resolution.

      Test python-docx (import docx), openpyxl, XlsxWriter (import xlsxwriter),
      pypdf

      and fpdf2 (import fpdf). Treat these as primary candidates, not confirmed
      merely

      because imports work. Do not confuse fpdf2 with the legacy fpdf
      distribution.

      DOCX: create, save, reopen and edit headings, paragraphs, a table and an
      image.

      XLSX: create and edit with openpyxl; create a formatted multi-sheet
      workbook

      with XlsxWriter, then read it with openpyxl. Check values, dates,
      formulas,

      formatting and embedded image/chart parts. Formula storage is not
      recalculation.

      PDF: generate a multi-page PDF with fpdf2, including an embedded font and
      image;

      use pypdf to read metadata/text, merge/split pages and round-trip the
      result.

      Evaluate PyMuPDF from the selected Pyodide package index for page
      rendering and

      richer extraction; evaluate ReportLab only if a needed generation feature
      is

      missing. Record licenses and native dependency requirements for chosen
      packages.

      Run these probes against the filesystem bridge, not only isolated MEMFS;
      also

      use MEMFS as a control to distinguish package failures from bridge
      failures.

      Check file paths with spaces/Unicode, BytesIO, seek and temporary-file
      behavior.

      Record exact install commands, versions, artifact assertions and failures
      in

      packages/safe-bash/docs/pyodide.md. A package listing or desktop Python
      success

      is not Pyodide validation. Keep unresolved priority workflows open. Unit
      tests

      must not download runtimes or write host files; keep real-runtime checks
      separate.
    status:
      implement: done
      test: done
  - id: implement-python-filesystem-bridge
    title: Connect Python filesystem operations to safe-fs without changing its
      contract
    prompt: >
      Read the current status and remaining acceptance gates in
      docs/plans/pyodide-safe-bash.md first. The optional Node Python command,
      canonical filesystem bridge, package provisioning, lifecycle controls and
      public integration suites already exist. Preserve working implementation;
      validate remaining gaps before changing code. Historical missing-adapter
      reports do not describe current main. The requirements below remain the
      acceptance target; implemented baseline statuses do not certify full
      compatibility or Cloudflare support.


      Implement the verified synchronous-Python to async-safe-fs design for the

      python/python3 shell commands. Read applicable AGENTS.md, canonical
      contracts

      in packages/safe-fs/src/contracts/,
      packages/safe-bash/src/contracts/filesystem.md,

      and the measured decisions in packages/safe-bash/docs/pyodide.md. Begin
      with

      failing conformance tests. Put filesystem translation in safe-fs and
      runtime

      integration in safe-bash; keep root code limited to public wiring.

      The caller's injected FileSystem remains authoritative for application
      files.

      Support ordinary open(), pathlib/os, imports, binary seekable descriptors
      and

      library temporary files. Define runtime stdlib/site-packages mounts
      separately

      from application storage without silently shadowing caller paths. Preserve

      cwd/path resolution, flags, errors, symlinks, metadata, retained
      identities,

      read-only behavior, mounted backends and quota/cancellation accounting.

      Advertise only capabilities whose entire canonical semantics are
      implemented;

      no provider-name branching or weakening atomic/retained guarantees. No
      full-tree

      mirroring, unbounded buffering or delayed writeback masquerading as shared
      files.

      Test delayed backends, partial reads/writes, append/exclusive modes, seek,

      truncate, rename/unlink with open handles, descriptor closure, errors and
      aborts.

      Reuse canonical conformance cases; use memfs/in-memory doubles for unit
      tests.

      Prevent deadlocks between interpreter workers, backend workers and shell
      pipes.

      Release outstanding operations and handles on exit, failure and
      termination.

      Wire optional browser-compatible public exports and maintained build
      declarations

      using parsed configuration edits. Run focused checks; do not edit README.
    status:
      implement: done
      test: done
  - id: implement-python-command
    title: Run Python files, modules and stdin through safe-bash
    prompt: >
      Read the current status and remaining acceptance gates in
      docs/plans/pyodide-safe-bash.md first. The optional Node Python command,
      canonical filesystem bridge, package provisioning, lifecycle controls and
      public integration suites already exist. Preserve working implementation;
      validate remaining gaps before changing code. Historical missing-adapter
      reports do not describe current main. The requirements below remain the
      acceptance target; implemented baseline statuses do not certify full
      compatibility or Cloudflare support.


      Implement python and python3 commands using the existing safe-bash
      command/plugin

      interfaces and the verified Pyodide integration. Read applicable
      AGENTS.md,

      packages/safe-bash/src/commands/safejs/, contracts/command.ts and
      shell/types.ts.

      Use TDD and register commands declaratively through existing mechanisms.

      Support python script.py arg..., python -c CODE arg..., python -m MODULE
      arg...,

      python - arg..., and noninteractive python reading source from stdin.
      Support

      --help and --version, option termination, -u and applicable CPython flags;
      define

      and test remaining flags rather than accepting and ignoring them.
      Inventory

      interactive/TTY behavior, including no-argument interactive use, against
      the

      shell's terminal contract; an unfinished mode remains a compatibility gap.

      Use CPython/Pyodide execution facilities for __main__, __file__,
      __package__,

      sys.argv, sys.path, encoding declarations, tracebacks and module
      execution.

      Do not merely eval the file contents. Read scripts and local imports from
      the

      canonical shell filesystem; support directory/zip __main__ entrypoints and

      Python shebang execution through the existing shell script resolution
      path.

      Inherit command cwd/env/stdin/stdout/stderr, honor redirects, pipes and
      exit

      codes, and preserve raw bytes through sys.stdin.buffer/sys.stdout.buffer.

      Cover SystemExit(None/int/string), syntax/runtime errors, missing
      files/modules,

      stdin source versus data, flushing, EOF, input(), broken pipes and shell
      status.

      Use an injectable runtime and lazy loading with visible initialization
      progress

      where the CLI needs it. Expose the same configuration through SDK and CLI
      using

      existing SDK wiring. No host Python subprocess fallback. Keep interpreter
      state

      isolated between command invocations like separate Python processes; reuse
      only

      when equivalent isolation is proven, including imports/env/cwd/global
      mutations.

      Run focused tests and manual CLI screenshot checks for visible behavior.
      Do not

      edit README. Full compliance must be measured, not claimed from a small
      subset.
    status:
      implement: done
      test: done
  - id: implement-python-packages
    title: Provide reliable installation and reuse of Python libraries
    prompt: >
      Read the current status and remaining acceptance gates in
      docs/plans/pyodide-safe-bash.md first. The optional Node Python command,
      canonical filesystem bridge, package provisioning, lifecycle controls and
      public integration suites already exist. Preserve working implementation;
      validate remaining gaps before changing code. Historical missing-adapter
      reports do not describe current main. The requirements below remain the
      acceptance target; implemented baseline statuses do not certify full
      compatibility or Cloudflare support.


      Implement package provisioning for safe-bash python/python3 backed by
      Pyodide.

      Read applicable AGENTS.md and the verified package/runtime matrix in

      packages/safe-bash/docs/pyodide.md. Use TDD with mocked package transport
      and

      in-memory storage in unit tests. Use matching Pyodide-built native wheels
      and

      micropip-compatible pure-Python wheels with dependencies; native desktop
      wheels

      must fail clearly. Support explicit package/version configuration via SDK
      and

      CLI, local compatible wheels in the canonical filesystem, requirements
      input,

      and a documented shell installation workflow such as python -m pip install

      only if faithfully implemented over the supported installer. A fake
      success

      or silently ignored pip option is not acceptable; inventory unsupported
      options.

      Installed packages must be importable by subsequent python invocations
      while

      user interpreter state remains isolated. Define environment scope, cache
      keys,

      version conflicts, cancellation/retry, offline preprovisioning and
      integrity.

      Do not infer dependencies by scanning import strings or download on every
      run.

      Provide an opt-in, version-pinned document package profile covering the
      verified

      python-docx/lxml, openpyxl, XlsxWriter, pypdf and fpdf2 dependencies. Keep
      runtime

      loading and package downloads out of ordinary non-Python shell startup.

      Honor configured transport policy for installation and expose download
      progress;

      distinguish installation from unrestricted Python networking. Verify
      install,

      import, package data, local modules, offline reuse, bad wheels, missing
      packages

      and dependency conflicts in a real runtime separately from fast unit
      tests.

      Keep implementation in packages, root wiring thin, no README edits.
    status:
      implement: done
      test: done
  - id: enforce-python-lifecycle
    title: Preserve shell streaming, cancellation and interpreter lifecycle
    prompt: >
      Read the current status and remaining acceptance gates in
      docs/plans/pyodide-safe-bash.md first. The optional Node Python command,
      canonical filesystem bridge, package provisioning, lifecycle controls and
      public integration suites already exist. Preserve working implementation;
      validate remaining gaps before changing code. Historical missing-adapter
      reports do not describe current main. The requirements below remain the
      acceptance target; implemented baseline statuses do not certify full
      compatibility or Cloudflare support.


      Harden the safe-bash python/python3 integration powered by Pyodide. Read

      applicable AGENTS.md, the shell command/I/O/cancellation contracts and the

      runtime design in packages/safe-bash/docs/pyodide.md. Add failing tests
      before

      fixes; do not rely on cooperative Python awaits for interruption.

      Ensure bounded streaming stdin/stdout/stderr, binary fidelity and
      backpressure

      for concurrent pipelines including python producer | python consumer.
      Avoid

      single-worker or single-interpreter scheduling deadlocks. Support
      cancellation

      of CPU loops, blocked stdin/filesystem calls, imports and initialization.
      Use

      verified runtime interrupts or worker termination as appropriate, cleaning
      up

      backend handles and suppressing late writes after finalization. Do not
      advertise

      hard CPU/memory limits without a demonstrated enforcement mechanism.

      Bound runtime concurrency and memory growth; define worker reuse,
      interpreter

      reset, package cache ownership and failure recovery. Test a successful
      command

      after error/abort and isolated concurrent commands over the same
      filesystem.

      Account for Python JS interoperability: Pyodide's JS access must not
      bypass

      claimed filesystem/network restrictions. Document actual trust boundaries
      and

      prevent accidental ambient host exposure; a worker alone is not a security
      proof.

      Inventory subprocess/os.system, threading, sockets and other native
      differences.

      Do not silently pretend these work or report universal compliance while
      gaps

      remain. Keep ordinary document library execution working without
      subprocesses.

      Run focused checks with real-runtime interruption cases separate from unit
      tests.
    status:
      implement: done
      test: done
  - id: verify-python-bash-and-artifacts
    title: Verify Bash-like Python behavior and real document workflows end to end
    prompt: >
      Read the current status and remaining acceptance gates in
      docs/plans/pyodide-safe-bash.md first. The optional Node Python command,
      canonical filesystem bridge, package provisioning, lifecycle controls and
      public integration suites already exist. Preserve working implementation;
      validate remaining gaps before changing code. Historical missing-adapter
      reports do not describe current main. The requirements below remain the
      acceptance target; implemented baseline statuses do not certify full
      compatibility or Cloudflare support.


      Verify the Pyodide-backed python/python3 commands using built public
      safe-bash

      exports, the canonical filesystem bridge and the configured document
      packages.

      Read applicable AGENTS.md. Add maintained integration coverage, with
      runtime

      assets provisioned outside fast unit tests. Compare matched-version native

      CPython-in-Bash and safe-bash executions for file/-c/-m/stdin modes,
      arguments,

      local/package imports, cwd/env, statuses, stderr, redirects, pipelines,
      heredocs,

      binary streams, shebang scripts and invocation isolation. Record
      intentional

      platform differences and unresolved gaps; a selected passing subset is not
      full

      compliance. Include memory and delayed asynchronous canonical backends,
      plus

      read-only/mount/quota compositions; verify file effects in both
      directions.

      Run ordinary script files through shell commands to create/edit/reopen
      DOCX with

      python-docx, XLSX with openpyxl and XlsxWriter, and PDF with fpdf2 plus
      pypdf.

      Check headings/tables/images, workbook values/styles/formulas/charts, and
      PDF

      text/page counts/images/fonts. Exercise temporary files and random-access
      I/O.

      Reopen artifacts with independent readers where possible. Render
      representative

      outputs and inspect screenshots; external rendering is QA evidence, not
      proof

      that an external renderer runs inside Pyodide. Distinguish XLSX formula
      storage

      from calculation and DOCX writing from Word-to-PDF conversion.

      Test setup/install failure, offline reuse, cancellation, output exhaustion
      and

      subsequent successful runs. Run CLI screenshot checks for new visible
      behavior.

      Keep manual QA as Markdown, no standalone QA script. Use npm run build and

      maintained test/lint routes appropriate to cross-workspace changes;
      preserve

      all required test membership and no unit-test host writes or runtime
      downloads.

      Document actual evidence and leave unsupported required workflows
      incomplete.
    status:
      implement: done
      test: done
  - id: document-python-usage
    title: Document Python commands, document recipes and measured compatibility
    prompt: >
      Finalize packages/safe-bash/docs/pyodide.md for Python running inside
      safe-bash.

      Read applicable AGENTS.md. Document verified setup, SDK and CLI
      configuration,

      all exposed options/env vars, runtime/deployment prerequisites, filesystem

      semantics, installation/local wheels/offline reuse and resource lifecycle.

      Provide copyable python report.py, python -m module, python -c, heredoc
      and

      pipeline examples plus ordinary synchronous Python scripts for DOCX, XLSX
      and

      PDF workflows using the exact qualified library versions. Scripts must use

      normal imports/open/pathlib; do not require user-visible async shell
      wrappers.

      Include a Python/CPython compatibility matrix and canonical filesystem
      capability

      matrix grounded in tests, including subprocess/threads/TTY/network limits
      and

      any remaining blockers to the user's full-compliance requirement. Explain

      Pyodide-built native dependencies, package failure diagnostics, formula
      evaluation,

      PDF rendering and document conversion boundaries accurately. Mark findings
      as

      runtime-tested or documentation-only; never turn untested candidates into
      claims.

      Execute examples against built public exports, record manual QA and
      screenshot

      outcomes, and keep priority document failures open. Do not modify README.

      Update docs/plans/pyodide-safe-bash.md readiness only when evidence
      warrants it.

      No commit, push or release is authorized merely by this documentation
      task.
    status:
      implement: done
      test: done
finalization: pending
name: pyodide-safe-bash
state: active
---

# Python inside safe-bash, powered by Pyodide

## Current implementation status — 2026-09-16

Inspected source revision: `24cc3a1856422dbc64c9badfde77450df6f25c4c`.
The optional Node.js Pyodide integration is implemented; the earlier statement
that current main has no Python adapter is stale. Implementation landed in
`1f6144c95` (`feat(python): add opt-in Pyodide runtime support`).
This update inspects source, maintained tests, current contracts and recorded QA;
it does not claim a fresh real-runtime execution or production acceptance.

Python is explicitly enabled with the `pythonCommands({ createWorker })` plugin,
SDK `runBash({ python: ... })`, or the CLI Python runtime options. Ordinary
`agentCommands()` does not enable Python. The documented Node deployment uses
an explicitly supplied Pyodide **314.0.6**, CPython **3.14.2**, wasm32 ABI
**2026_0**, on Node **22 or newer**, with `trustedPython: true`.
The isolated pinned runtime is not installed in this checkout, so fresh runtime
qualification requires provisioning it through the maintained integration route.

### Task status and evidence

An implementation status of `done` records the existing baseline or maintained
verification suite. A test status of `open` keeps that task's full acceptance
requirements unfinished; it does not mean no tests exist. Preserve the original
requirements and working baseline when continuing these tasks.

| Task | Implemented or recorded evidence | Remaining acceptance |
| --- | --- | --- |
| Runtime/filesystem proof | Dedicated interpreter worker and shared-memory RPC; ordinary synchronous Python uses canonical async storage. | Full backend/deployment preservation proof remains open. |
| Document-library proof | Recorded DOCX/XLSX/PDF workflows on memory and delayed canonical storage; separate browser fixtures. | Quota-backed priority workflows and complete document/library coverage remain open. |
| Filesystem bridge | [PythonFileSystem](../../packages/safe-fs/src/python/filesystem.ts), flag/stat translation and [worker mount integration](../../packages/safe-bash/src/commands/python/worker.ts); maintained filesystem tests. | Backend descriptor/metadata fidelity, unsupported flags and required wrapper workflows. |
| Python commands | [Command plugin](../../packages/safe-bash/src/commands/python/index.ts), [launcher](../../packages/safe-bash/src/commands/python/execution.ts), [SDK](../../src/sdk/bash.ts), [CLI](../../src/cli/commands/bash.ts); launcher and public parity suites. | Interactive TTY and complete CPython/platform parity. |
| Packages | [Provisioning](../../packages/safe-bash/src/commands/python/provisioning.ts), explicit requirements/local wheels/document profile, bounded cache and offline reconstruction; installer/provisioning tests. | Full native/package/workflow qualification and platform-specific limitations. |
| Lifecycle | Fresh workers, immediate bounded concurrency admission, bounded streaming and worker termination; admission/worker/public lifecycle suites. | Complete host/network confinement, hard resource bounds and all-provider cleanup qualification. |
| Bash/artifact verification | Maintained public command-parity, document and lifecycle integration suites exist. | Fresh integrated acceptance, required quota workflow and the broader original matrix. |
| Usage documentation | [Usage guide](../../packages/safe-bash/docs/pyodide.md), [package guide](../../packages/safe-bash/docs/python-packages.md), options, recipes and compatibility matrices. Historical finalization QA supports closing this task. | Update documentation as remaining capabilities are implemented; full feature acceptance stays open. |

The September 13 usage finalization QA recorded a successful normal build,
68 passing public integration test entries, one retained quota TODO, no unexpected
failures or skips, executed examples, independently reopened document artifacts,
six rendered recipe pages and inspected CLI screenshots. That record is retained
in Git at `314ba0299^:docs/plans/python-usage-finalization-qa.md`; the cleanup
commit deleted the working-tree document. These are historical scoped results,
not a fresh run against the inspected revision. Current maintained suites are
[public-command-parity](../../packages/safe-bash/tests/integration/pyodide-runtime/public-command-parity.test.mjs),
[public-documents](../../packages/safe-bash/tests/integration/pyodide-runtime/public-documents.test.mjs)
and [public-lifecycle](../../packages/safe-bash/tests/integration/pyodide-runtime/public-lifecycle.test.mjs).

### Remaining acceptance gates

Fresh [main-module and stream user QA](pyodide-main-loader-qa.md) records
141 passes and three failing required TODOs through the complete maintained
built-public route. Fourteen added matched-native cases reproduce and fix
inline/stdin main-loader metadata and verify stream encoding/newline behavior.
Memory/delayed artifacts reopen in native readers; external DOCX/XLSX/PDF
previews and CLI captures are inspected with renderer limitations recorded.
TemporaryDirectory cleanup, quota descriptors and broader acceptance remain
open; this run does not change readiness or finalization.

An independent [user QA rerun](pyodide-independent-user-qa.md) on 2026-09-16
reproduces all four passing browser document profiles, 56 passing matched-native
public parity entries and 45 passing real worker/stdio entries. Public document
and lifecycle verification reports 18 passes and three failing required TODOs
(two TemporaryDirectory cleanup profiles and quota reads), with zero unexpected
failures or skips. No production changes are needed for the passing workflows;
the unsupported required capabilities remain open. This scoped rerun does not
change readiness or finalization.

Fresh document package qualification on 2026-09-16 passes all four real Chrome
worker profiles (MEMFS, scoped immediate/delayed canonical bridge and root
bridge), including PyMuPDF rendering/extraction. The public ordinary-script
suite now reuses that qualified workload. It reproduces a required unresolved
`TemporaryDirectory` cleanup failure: CPython's safe descriptor-based rmtree
hits ENOTSUP opening a retained directory. Keep its explicit failing TODO on
memory/delayed storage open; browser fixture success does not qualify the public
descriptor path. Exact versions, commands, source bindings and assertions are
recorded in `packages/safe-bash/docs/pyodide.md`. No production implementation
was changed and overall readiness/finalization are unchanged.

Fresh [user edge QA](pyodide-user-edge-qa.md) verifies the current built public
worker, matched native command behavior, ordinary scripts and document workflows.
It adds memory/delayed absolute-directory-symlink and retained append coverage,
and fixes a reproduced installer diagnostic that masked corrupted-cache integrity
errors. Required quota support and full deployment/contract qualification remain
open; these scoped checks do not change readiness or finalization.

- The public lifecycle suite retains `required Python quota mount supports reads,
  bounded writes and recovery` as a TODO because canonical quota storage refuses
  descriptor open with ENOTSUP. This is an unfinished required workflow.
- Complete canonical backend/metadata/descriptor fidelity is not established.
  General no-follow opens, retained directory descriptors and descriptor-relative
  stat remain unsupported; mount/readonly successes do not qualify every backend.
- Native process/thread behavior, interactive terminals and unrestricted guest
  networking do not match ordinary desktop CPython. Formula storage is not
  recalculation, and document round trips do not establish office conversion or
  arbitrary rendering/fidelity.
- Node worker termination and bridge/cache bounds do not establish a hostile-code
  sandbox or hard CPU, Wasm heap, RSS or decompressed-package quotas. Admission
  requires trusted Python and trusted imported package code.
- Cloudflare/workerd is not implemented or qualified by the Node shared-memory
  bridge. The host must remain off the interpreter's blocking event loop. A
  supported same-isolate suspension/FS architecture and achievable cancellation,
  isolation, memory, persistence and deployment contracts remain separate work.
  The existing [archived Cloudflare plan](archive/pyodide-cloudflare-safe-bash.md)
  records that scope; it is not current deployment acceptance.

### Continue from the implemented baseline

Provision the explicitly pinned isolated runtime, then execute maintained public
integration and relevant canonical filesystem checks against current built public
exports. Reproduce the retained quota failure and other required gaps before
fixes; use TDD and preserve stronger filesystem guarantees. Keep fresh passes,
TODOs, skips and unavailable cases separate. Use the current
[compatibility matrix](../../packages/safe-bash/docs/pyodide.md#current-compatibility-and-canonical-filesystem-matrix)
and [Python contract](../../packages/safe-bash/src/contracts/python.md) rather than
historical missing-adapter reports to choose remaining work.

Readiness remains **draft**, state **active**, and finalization **pending**.
Baseline implementation and documentation are available; full acceptance remains
unfinished. This status update does not authorize implementation, deployment,
commit, push or release on its own.

## Original planning rationale

### Fresh runtime qualification — 2026-09-16

Working-tree baseline HEAD: `06fac91e776c2c56c8a1ad9036ebaca60f55d67a`;
unrelated in-progress edits were preserved. No production Python/FS code changed:
the suspected retained-metadata defect was not reproduced in the real runtime.
Added public memory/delayed coverage proves fchmod/fchown refuse with ENOTSUP,
replacement and retained modes remain intact, truncate still addresses the held
object, and all handles close.

Provisioned the maintained isolated Pyodide 314.0.6 dependency. On Node 22.22.2,
the ordinary-script proof passes on memory and 1ms-delayed canonical storage
(166 operations each), bounded-pipe integration passes 13/13, blocked backend
read cancellation closes its retained handle, and public matched-CPython 3.14.2
command parity passes 56/56. The selected public lifecycle runs report 11 passes
and one failing quota TODO; no unexpected failures or skips. Canonical Python
and retained-quota checks pass 118/118; the normal npm run build succeeds.
These are scoped working-tree results, not remote delivery or full acceptance.

Extended the existing opt-in callback experiment to exercise supported run_sync.
Node 24.21.0 with --experimental-wasm-stack-switching passes the Python-entry
control, but re-entry from the actual native FS read callback raises NoGilError
(Python's GIL is not held). That explicit --suspension experiment exits 1;
ordinary Promise callbacks remain invalid on both Node versions. A recovery
attempt also caused fatal Wasm memory access failure. Keep this probe in a fresh
process; it is blocker evidence, not a pass or an admitted suspension design.

Required quota reads still fail ENOTSUP. Supporting writable quota descriptors
requires retained identity/size admission for positioned and cursor/append writes,
aliases and unlinked handles, coordinated with existing quota mutations and
retirement; path writeback or bypassing the wrapper is not acceptable. The current
canonical resize-only route does not supply byte writes. Cloudflare still lacks
the admitted shared-memory bridge, and this run_sync adaptation cannot replace it.
Direct Wasm import suspension, a separately qualified runtime build, browser
deployment and broader backend guarantees remain open. Full preservation across
the requested contexts is not established. Keep implement/test open for the
runtime proof, readiness draft and finalization pending. Commands and limitations
are recorded in packages/safe-bash/docs/pyodide.md.

The user requires Python to behave like Python in Bash: run files, import and
use libraries, and retain the same filesystem contract. Word, Excel and PDF
workflows are priority acceptance requirements. The previous Python-calls-shell
API design is superseded; a reverse bridge alone does not fulfill this request.

Expected surface:

```sh
python report.py input.json output.docx
python3 workbook.py input.xlsx output.xlsx
python pdf_report.py output.pdf
python -m my_package --output result.json
printf 'hello\n' | python -c 'import sys; print(sys.stdin.read().upper(), end="")'
```

Existing code provides the canonical FileSystem in safe-fs, streaming command
interfaces in safe-bash and an injected-runtime pattern in commands/safejs.
The central feasibility gate is making synchronous Python file and stream
operations work over async canonical backends without copying the filesystem
or weakening capabilities. This must be proved before broad implementation.

## Library investigation

These are researched candidates; no Pyodide runtime/package smoke test has been
run while writing this plan. Installation/import alone will not qualify them.

| Workflow | Candidate and loading route | Required proof |
| --- | --- | --- |
| Word | python-docx via micropip, with matching Pyodide lxml | Create/edit/reopen DOCX with text, tables and images |
| Excel read/edit | openpyxl via micropip | XLSX round trips with values, formulas and styles |
| Excel creation | XlsxWriter via micropip | Formatted workbooks/charts readable by openpyxl |
| PDF manipulation | pypdf via micropip | Extract, merge, split and reopen PDFs |
| PDF generation | fpdf2 via micropip, matching Pillow/font dependencies | Multi-page PDF with font/image and extractable text |
| PDF rendering | PyMuPDF if provided by the pinned runtime | Render pages and inspect output |

Official documentation establishes a plausible installation path: Pyodide can
install pure-Python wheels and provides builds of lxml, Pillow and PyMuPDF in its
current published package list. Exact runtime compatibility still needs testing.
python-docx depends on lxml. openpyxl reads/writes XLSX; XlsxWriter creates XLSX
but does not edit existing workbooks. pypdf handles PDF extraction/manipulation;
fpdf2 is a generation candidate. These libraries do not by themselves establish
Excel calculation or Word-to-PDF rendering support.

Sources:
- [Pyodide package loading](https://pyodide.org/en/stable/usage/loading-packages.html)
- [Pyodide package list](https://pyodide.org/en/stable/usage/packages-in-pyodide.html)
- [python-docx installation](https://python-docx.readthedocs.io/en/latest/user/install.html)
- [openpyxl](https://openpyxl.readthedocs.io/en/stable/)
- [XlsxWriter](https://xlsxwriter.readthedocs.io/introduction.html)
- [pypdf](https://pypdf.readthedocs.io/en/stable/)
- [fpdf2](https://py-pdf.github.io/fpdf2/)
- [Pyodide platform constraints](https://pyodide.org/en/stable/usage/wasm-constraints.html)

## Compatibility and completion

Full compliance is the requested target, not a claim this plan can already make.
Pyodide documents native OS differences, including threading/multiprocessing and
network limitations. Unsupported required behavior must remain a visible gap;
it cannot be removed from acceptance just because the runtime lacks it.

Implementation must preserve the caller's canonical filesystem and ordinary
Python library APIs. The original requirements above remain the acceptance
target. Continue from the implemented Node baseline and retain unresolved
feasibility, compatibility and deployment gates. The current status section and
frontmatter distinguish completed baseline work from unfinished acceptance.

## Package provisioning user edge verification — 2026-09-16

The [installer QA plan and measured results](python-package-provisioning-qa.md)
record a fresh real-runtime provisioning run: 24 passing entries, no failures,
skips or TODOs. Python command units pass 145/145. Matching native wheels,
pure-wheel dependencies, package data, local modules, extras, offline reuse,
version conflicts, bad wheels, cancellation/retry and integrity are exercised.
An additional rebuilt-public-export smoke check verifies installation from a
canonical requirements file and fresh-plugin offline interpreter isolation.

A failing in-memory regression reproduced incorrect handling of tab-delimited
inline comments and comments ending in a backslash. Comment stripping now occurs
before continuation validation; direct URL integrity fragments remain intact.
The real installer fixture includes both regressions. Existing implementation
and unrelated changes are preserved; no README changes or remote delivery.
These scoped results do not close the remaining filesystem, compatibility,
guest-confinement or Cloudflare gates above.

## Shutdown user edge verification — 2026-09-16

The [shutdown QA plan](pyodide-shutdown-edge-qa.md) continues from the existing
implementation. Three added built-public lifecycle checks pass without
production changes: ordinary reverse-order atexit callbacks preserve binary
canonical file bytes and buffered output, and worker termination interrupts both
an atexit CPU loop and blocked stdin. Each abort retires retained handles,
preserves completed writes, suppresses late output and permits a successful next
command at worker capacity one. Cancellation does not promise completion of
remaining Python shutdown callbacks.

Fresh real product-worker/stdio checks pass 45/45 and Python command units pass
145/145. The normal build succeeds and the built CLI shutdown screenshot is
inspected. The complete maintained public integration rerun against the completed
build reports 127 passes and three failing required TODOs, with zero unexpected
failures or skips. The TODOs reproduce memory/delayed TemporaryDirectory cleanup
and quota-backed descriptor refusal with ENOTSUP; they are not passes. Package
typecheck and integration inventory pass. These are scoped working-tree results;
required filesystem gaps,
hard resource enforcement, hostile-code confinement and Cloudflare acceptance
remain open. Readiness stays draft and finalization stays pending.
