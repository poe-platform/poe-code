---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1
readiness: draft
tasks:
  - id: prove-python-runtime-and-filesystem
    title: Prove ordinary Python execution over the canonical shell filesystem
    prompt: >
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
finalization: completed
name: pyodide-safe-bash
state: archived
---

# Python inside safe-bash, powered by Pyodide

## Current qualification and readiness

The [Python usage guide](../../packages/safe-bash/docs/pyodide.md) separates
current public-export behavior from historical experiments. The
[usage finalization QA record](python-usage-finalization-qa.md) records the
documentation examples, build, runtime checks and inspected screenshots.
The 2026-09-13 finalization run passed the normal build, copied SDK/command/
installer/document examples and the maintained public integration route:
68 passing test entries, one retained quota TODO, no unexpected failures or
skips. Six rendered recipe pages and CLI help/output screenshots were inspected.
Only the documentation task is closed by this evidence; the quota failure and
broader compatibility gaps remain open.
The remaining text below preserves the original planning rationale; its
statements about unexecuted experiments and open implementation steps describe
that initial planning stage, not the current implementation.

Readiness remains **draft** and finalization remains **pending**. Successful
document workflows on memory and delayed canonical storage do not establish
the required quota-backed workflow or full filesystem/CPython compatibility.
Native processes/threads, interactive terminals, complete host/network
confinement, hard resource limits and unqualified document conversion/rendering
paths remain visible gaps. Earlier task status entries record their scoped
implementation work; they are not evidence of full-compliance acceptance.
No commit, push or release is authorized by this documentation task.

## Original planning rationale

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
Python library APIs. The filesystem and document-library feasibility tasks run
first so architecture is based on evidence. All eight task prompts are
self-contained; configured implement/test steps remain open. No implementation,
commit, push or release is performed while revising this plan.
