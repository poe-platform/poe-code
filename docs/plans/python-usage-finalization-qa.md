# Python usage finalization manual QA

This is the manual execution record for finalizing
`packages/safe-bash/docs/pyodide.md`. Read root and safe-bash `AGENTS.md`.
Verification uses the live working tree and built public exports, not a frozen
commit or published release. Preserve previous captures. Fresh evidence belongs
under `output/python-usage-finalization/`.

## Execute

1. Wait for the root-owned maintained build to finish. Record its actual result.
2. Reuse the explicitly provisioned Pyodide 314.0.6 document cache from
   `output/python-public-integration-20260913/cache`. Acceptance must not download.
   Use the matching native CPython 3.14.2 executable as differential oracle.
3. Execute the maintained public integration route with a new artifact directory;
   retain raw output and status. Report passing entries, TODOs and skips separately.
4. Copy the final documented script, module, inline, heredoc, pipeline and document
   recipes into canonical memory storage. Execute them through built public
   exports with ordinary synchronous Python. Record exact source blocks and
   actual distribution versions, outputs and errors.
5. Reopen captured document artifacts with independent readers and inspect rendered
   pages. Record each inspected screenshot and renderer version; external formula
   evaluation and conversion are not guest capabilities. Root owns CLI captures.
6. Keep required quota and priority document gaps open. Runtime-tested finite
   examples do not establish full CPython, provider, browser or document parity.

## Results

The root-owned normal `npm run build` completed successfully. The required
`screenshot-poe-code` help capture then completed its cached preparation before
runtime acceptance began; that cached preparation is not independent build
evidence. Root inspected `cli-help.png`; all Python options were legible. Build
and screenshot logs are in the evidence directory.

The public integration invocation is:

```sh
SAFE_BASH_NATIVE_PYTHON=/Users/kjopek/.local/share/uv/python/cpython-3.14.2-macos-aarch64-none/bin/python3 \
SAFE_BASH_PYTHON_CACHE="$PWD/output/python-public-integration-20260913/cache" \
SAFE_BASH_PYTHON_ARTIFACT_DIR="$PWD/output/python-usage-finalization/documents" \
npm run test:python:integration --workspace=virtual-bash \
  > output/python-usage-finalization/public-integration.log 2>&1
```

`input-hashes.json` records Node version, capture time and SHA-256 of the executed
built root/CLI/safe-bash/Python worker/safe-fs exports and maintained public
integration fixtures. Native oracle: CPython 3.14.2, Apple's GNU Bash 3.2.57 on
macOS; Node 22.23.2, Pyodide 314.0.6, guest platform `emscripten`, 32-bit pointers
and empty `sys.executable`. This does not qualify another host or Python version.

### Exact documented examples

The draft guide's fenced blocks were parsed as Markdown fences and captured
unchanged in `documented-blocks.json`. This preserved draft snapshot includes a
CLI launcher spelling corrected later; it is not a claim that every captured
block was executed or matches the final guide. The six executed blocks identified
below were separately compared with the final guide. `python-example.mjs`, `docx_report.py`,
`xlsx_report.py` and `pdf_report.py` are literal example captures, not standalone
QA programs. No new automated QA script was added.

The first SDK block ran from the checkout root as:

```sh
node --input-type=module < output/python-usage-finalization/python-example.mjs \
  > output/python-usage-finalization/sdk-example.log 2>&1
```

This keeps its `import.meta.url` base in the checkout, matching the documented
root-level module placement. It imports built `poe-code.runBash` and canonical
memory storage; exit 0, stdout `hello from Python`, no stderr.

A manual Node stdin session imported built `Shell`, `agentCommands`,
`pythonCommands`, canonical `MemoryFileSystem`, and the maintained public runtime
fixture's `createWorker`/`createOfflineCache`. It seeded the same `/work/report.py`
and `/tmp`, then passed the exact six-command shell block to `shell.exec`.
All forms completed: `python report.py`, alias `python3`, inline `-c`, piped
`python -m json.tool`, quoted heredoc and Python-to-`head` pipeline. The combined
stdout contained four `hello from Python` lines, formatted count 3 JSON and
`ALPHA`; exit 0, no stderr. A separate `python -m report` also printed the hello
line with exit 0. Raw exact source/results: `documented-examples.log`.

The same canonical storage received the three captured `.py` blocks. A new
configured shell selected `packageProfile: 'documents'` and the preprovisioned
offline cache; its transport threw if called. These exact commands all exited 0
without stderr, including their independent reopen assertions:

```sh
python docx_report.py
python xlsx_report.py
python pdf_report.py
```

Observed stdout was respectively `report.docx reopened and edited`,
`report.xlsx edited; writer.xlsx cached result verified`, and
`report.pdf generated; first-page.pdf reopened`. Host reads captured the five
resulting files in `recipes/`. All eleven actual distribution versions in
`versions.json` match the guide: python-docx 1.2.0, lxml 6.0.2, openpyxl 3.1.5,
XlsxWriter 3.2.9, pypdf 6.18.1, fpdf2 2.8.8, Pillow 12.2.0, fonttools 4.65.0,
defusedxml 0.7.1, et-xmlfile 2.0.0 and typing-extensions 4.16.0. Package transport
calls: zero. Every interpreter was disposed through `shell.dispose()` in finally.

### Installer and offline reuse

The exact three installation examples also ran against built public exports:

```sh
python -m pip install pypdf==6.18.1
python -m pip install -r /requirements.txt
python -m pip install /wheels/et_xmlfile-2.0.0-py3-none-any.whl
```

The host explicitly seeded canonical `/requirements.txt` with `pypdf==6.18.1`
and the named wheel from the provisioned cache artifact with SHA-256
`7a91720bc756843502c3b7504c77b8fe44217c85c537d85037f0f536151b2caa`.
Each printed `Successfully installed requested Python packages`, exit 0 and no
stderr. A fresh interpreter imported both packages and reported `6.18.1 2.0.0`.
Configured package transport calls: zero. `documented-installer.log` records
commands/results; the wheel is preserved as an explicit input capture.

A separate local-wheel check used ordinary Python `zipfile` to create the small
pure `demo-1.0-py3-none-any.whl` fixture in canonical storage, installed it, and
imported its value 73 in two subsequent fresh interpreters. All four commands
passed offline with zero transport calls. `local-wheel.log` retains exact Python
source and commands. This tiny wheel is a scoped install/reuse witness, not
qualification of native wheels or arbitrary package dependency graphs.

### External artifact rendering and screenshots

The documents and PDF skills were used for read-only render/inspection. The
literal documented recipes were not replaced with host Python authoring.

```sh
/Users/kjopek/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 \
  /Users/kjopek/.codex/plugins/cache/openai-primary-runtime/documents/26.909.12148/skills/documents/render_docx.py \
  output/python-usage-finalization/recipes/report.docx \
  --output_dir output/python-usage-finalization/render-docx --emit_pdf
/Users/kjopek/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/override/soffice \
  -env:UserInstallation=file:///tmp/python-usage-finalization-lo --headless \
  --convert-to pdf --outdir output/python-usage-finalization/render-xlsx \
  output/python-usage-finalization/recipes/report.xlsx \
  output/python-usage-finalization/recipes/writer.xlsx
pdftoppm -scale-to 1400 -png output/python-usage-finalization/recipes/report.pdf \
  output/python-usage-finalization/render-pdf/report
pdftoppm -scale-to 1400 -png output/python-usage-finalization/recipes/first-page.pdf \
  output/python-usage-finalization/render-pdf/first-page
pdftoppm -scale-to 1400 -png output/python-usage-finalization/render-xlsx/report.pdf \
  output/python-usage-finalization/render-xlsx/report
pdftoppm -scale-to 1400 -png output/python-usage-finalization/render-xlsx/writer.pdf \
  output/python-usage-finalization/render-xlsx/writer
```

All rendering commands exited 0. LibreOffice emitted fontconfig cache warnings;
exports still completed. Six PNGs were actually opened and inspected:

- `render-docx/page-1.png`: readable title, accented Café/em dash and edited count
  4; the python-docx default title styling remains visible.
- `render-xlsx/report-1.png`: values 9 and 3, bold Count heading, externally
  recalculated formula result 12; `writer-1.png`: values 7, 3 and 10.
- `render-pdf/report-1.png`, `report-2.png`, `first-page-1.png`: expected title,
  second-page text and extracted first page.

No clipping, overlap or broken glyphs were observed. These are small functional
recipe fixtures. The maintained broader integration fixture's new artifacts are
captured separately in `documents/`; they received runtime structural checks,
not another external render in this pass. Historical chart/image render evidence
remains in the earlier document QA records.

Independent `pdfinfo`, `pdftotext` and `pdffonts` output is retained: two original
PDF pages, expected text, unembedded standard Helvetica. Renderer versions are
LibreOfficeDev 26.8.0.0.alpha0 (`2c87e51eeaa2b413ff4ae097b2705eea1995d8e5`)
and Poppler 26.08.0. LibreOffice's recalculated 12 is **external** evidence;
the guest explicitly checked absent openpyxl caches and XlsxWriter's supplied
10. Neither external conversion nor rendering happened inside Pyodide.

### CLI captures

Root executed and inspected the required help route:

```sh
POE_SCREENSHOT_ROWS=75 npm run screenshot-poe-code -- \
  --output output/python-usage-finalization/cli-help.png bash --help
```

Root then used `npm run screenshot -- --no-header --output PATH node dist/bin.cjs
bash --root output/python-usage-finalization --python-runtime URL --python-trusted
-c SOURCE`, with URL set to the absolute pinned loader file URL. The pipeline
and intentional exception captures `cli-pipeline-output.png` and
`cli-traceback-output.png` were inspected by root: readable `HELLO`, and a full
traceback including `raise ValueError(42)`. Original header captures remain as
history but were too wide; the output-only captures are the inspection evidence.
`cli-statuses.json` separately records actual built CLI statuses: pipeline 0,
exception 1, unsupported `python -i` 2. The successful pipeline emitted one
`Initializing Python...` progress message on stderr.

Pipeline source was `printf "hello\n" | python -c 'import sys;
print(sys.stdin.read().upper(), end="")'`. Exception source was
`python -c 'raise ValueError(42)'`; the interactive diagnostic used `python -i`.
Exact argv is retained in the screenshot logs; stdout/stderr/status are in
`cli-statuses.json`.

### Final integration and platform results

The maintained public integration route exited **0** in **173.133 seconds**:
**69 test entries, 68 passed, one TODO, zero unexpected failures, zero skips,
zero cancellations**. Parent groups are counted as test entries; this is not
69 passing workflows. Both memory and delayed document cohorts passed, including
stream/file-object, temporary-file, non-ASCII/spaced path and both-direction
canonical effects. Delayed document profile recorded **3,566 canonical operations
and zero remaining handles**.

The required quota workflow remains **open**. Its real assertion still fails at
`Path('/quota/input').read_text()` with `OSError: [Errno 138] Not supported`.
The TODO is not a pass. Separate passing tests establish truthful refusal and
recovery; they do not establish useful quota-backed Python reads/writes.

The same built `runBash` public SDK executed a synchronous `python -` platform
probe. `platform-probes.log` retains its full source and output. Exit 0, no
stderr: stdin/stdout/stderr `isatty()` are all false; `os.system('exit 73')`
returns -1; `subprocess.run` raises `OSError` (Emscripten does not support
processes); `os.fork` and `socket.socket` raise `OSError` (function not
implemented); `threading.Thread(...).start()` raises `RuntimeError` (cannot
start a new thread). No external socket connection was attempted. This verifies
those ordinary API refusals, not security against hostile Python/JavaScript
interop or all guest HTTP-library routes.

Priority document requirements remain open: formula evaluation inside Pyodide,
general DOCX/XLSX pagination/conversion, arbitrary PDF rendering in this current
Node/public-export cohort, and unqualified native dependencies/extensions.
ReportLab remains unevaluated; these recipes do not establish its installation
or operation. Other earlier package failures remain open unless separately
resolved by evidence. Historic PyMuPDF browser evidence remains scoped to that fixture.
Remote canonical adapters, full filesystem/POSIX parity, browser public-command
deployment and complete CPython/Bash compatibility are not certified here.

`post-run-input-check.json` compares all **14** captured built exports/fixture
inputs with their pre-run hashes and checks SHA-256 of **seven** guide blocks
against the final guide. **All unchanged**. Six were executed in this run: the
first SDK block, invocation block, installer block and three document recipes.
The seventh, historical `Pinned installation inputs` Python block, was compared
only and was not executed in this run. The raw hash record remains unchanged.
This is a finite input
check, not an append-proof repository snapshot. Root also recorded passing local
documentation links/fences/whitespace and parsed-plan checks in
`document-checks.json`, plus `git diff --check`. Full repository unit/lint gates
were not rerun for this documentation-only change.

No commit, push or release was authorized or performed by this task.
