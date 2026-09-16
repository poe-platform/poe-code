# Python through Pyodide

Status: **optional implementation available; complete qualification remains open**.
Fresh [main-module and stream user QA](../../../docs/plans/pyodide-main-loader-qa.md)
records 141 passing built-public integration entries and three required failing
TODOs on September 16. Matched CPython 3.14.2 differential checks reproduce and
fix the main-module loader for inline/stdin execution (`BuiltinImporter`);
file mode retains `SourceFileLoader`. Additional encoding/error-policy,
universal-newline and binary-input checks pass for both aliases. Independent
host readers reopen memory/delayed documents. These results do not close the
TemporaryDirectory cleanup, quota, complete filesystem or deployment gates.

The [Python command contract](../src/contracts/python.md) describes the current
explicit `pythonCommands({ createWorker })` plugin and worker integration.
It registers `python`/`python3`; `agentCommands()` does not enable them by default.
The historical experiments below precede that implementation. Their statements
that command registration is absent describe those experiments, not the current
plugin. Scoped passes do not establish complete filesystem or deployment coverage.

Fresh [user edge QA](../../../docs/plans/pyodide-user-edge-qa.md) records the
September 16 built-public command, document, delayed-storage and lifecycle
checks. It also reproduces and fixes installer diagnostics that hid a corrupted
cache's integrity failure behind micropip's generic metadata error. Required
quota workflows and broader deployment qualification remain open.

Package provisioning now has an explicit implementation under the optional
Python plugin. See [package environments](python-packages.md) for SDK/CLI
configuration, supported installer options, cache/offline policy and the pinned
document profile. The historical experiments below retain their original
package-provisioning gaps; current runtime evidence is recorded separately in
the [provisioning QA record](../../../docs/plans/python-package-provisioning-qa.md).

Python must execute ordinary scripts, modules and imports against the caller's
canonical `FileSystem`. Python invoking `shell.exec`, copying a workspace into
MEMFS, or replaying a tree after execution does not satisfy this contract.
Pyodide's own interpreter/standard-library assets are distinct from user files.

## Setup and ordinary Python usage

The supported deployment is **Node.js 22 or newer**, with the explicitly supplied
**Pyodide 314.0.6 / CPython 3.14.2 / wasm32 ABI 2026_0** runtime. The recorded
runtime checks use Node **22.23.2**. Other Node versions are prerequisites allowed
by the package, not independently tested profiles. This workspace's safe-bash
package is private; the examples use built `poe-code` public exports, not a
separately installable `safe-bash` package. They do not assert npm publication.

For a checkout, build the public exports and install the isolated pinned runtime:

```sh
npm run build
npm ci --prefix packages/safe-bash/tests/integration/pyodide-runtime --ignore-scripts
```

Supply an absolute file URL for `pyodide.mjs` and retain its adjacent `.wasm`,
standard-library ZIP, lock/index and package assets. The isolated install places
the module at `packages/safe-bash/tests/integration/pyodide-runtime/node_modules/pyodide/pyodide.mjs`.
Setting `indexURL` explicitly selects the runtime asset directory; otherwise it
defaults to the module's directory. Runtime loading is trusted host work and is
separate from installer download authorization. Neither command registration nor
a non-Python shell command initializes Python. Arbitrary guest code is not an
admitted security profile: the Node endpoint requires `trustedPython: true`.

Save this as `python-example.mjs` at the checkout root. Application paths here
are canonical memory paths, and the Python script uses ordinary `pathlib`:

```js
import { runBash } from 'poe-code';
import { MemoryFileSystem } from 'poe-code/safe-bash';

const fs = new MemoryFileSystem();
await fs.mkdir('/work', { recursive: true });
await fs.writeFile('/work/report.py', new TextEncoder().encode(
  'from pathlib import Path\n'
  + 'Path("report.txt").write_text("hello from Python\\n", encoding="utf-8")\n'
  + 'print(Path("report.txt").read_text(encoding="utf-8"), end="")\n'
));
const result = await runBash({
  fs, cwd: '/work', source: 'python report.py',
  python: {
    trustedPython: true,
    runtimeModuleURL: new URL(
      './packages/safe-bash/tests/integration/pyodide-runtime/node_modules/pyodide/pyodide.mjs',
      import.meta.url,
    ).href,
  },
});
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exitCode = result.exitCode;
```

Run it with `node python-example.mjs`. Expected output is `hello from Python`.
The async host API services filesystem requests on its event loop; Python does
not call an async shell wrapper. To use host files, replace `fs` with
`root: '/absolute/project'`; that directory becomes canonical `/`. Do not pass
host absolute paths as Python filenames expecting implicit host access.

For repeated commands with one package environment, construct `Shell` explicitly:

```js
import { Shell, agentCommands } from 'poe-code/safe-bash';
import { pythonCommands } from 'poe-code/safe-bash/commands/python';
import { createNodePythonWorker } from 'poe-code/safe-bash/commands/python/node';

// Reuse the fs seeded above; resolve the explicitly selected runtime module.
const runtimeModuleURL = new URL(
  './packages/safe-bash/tests/integration/pyodide-runtime/node_modules/pyodide/pyodide.mjs',
  import.meta.url,
).href;
const shell = new Shell({ fs, cwd: '/work' }).use(agentCommands()).use(
  pythonCommands({
    createWorker: () => createNodePythonWorker({ trustedPython: true, runtimeModuleURL }),
  }),
);
try {
  const result = await shell.exec('python report.py');
  console.log(result.stdout);
} finally {
  await shell.dispose();
}
```

Inside either configured shell, these are the ordinary command forms:

```sh
python report.py
python3 report.py
python -c 'from pathlib import Path; print(Path("report.txt").read_text(), end="")'
printf '{"count":3}\n' | python -m json.tool
python - <<'PY'
from pathlib import Path
print(Path("report.txt").read_text(encoding="utf-8"), end="")
PY
printf 'alpha\nbeta\n' | python -c 'import sys; print(sys.stdin.read().upper(), end="")' | head -n 1
```

`python -m json.tool` demonstrates module execution with stdin as data. For a
local module, save `report.py` in the canonical cwd and run `python -m report`.
File, `-c` and `-m` forms leave stdin for the program; `python -` and no-argument
Python consume it as source. A heredoc supplying source therefore cannot also
supply independent program input on that same stream. Quoted heredoc delimiters
prevent shell expansion of the Python body. CLI source is passed with `-c`:

```sh
node dist/bin.cjs bash --root /absolute/project --cwd / \
  --python-trusted --python-runtime file:///absolute/runtime/pyodide.mjs \
  -c 'python report.py'
```

Replace the two absolute locations with the explicit project and runtime paths.
The installed launcher spelling is `poe-code bash` with the same arguments.
This is a noninteractive CLI; it does not expose a Python terminal/REPL.

## Complete Python configuration

These are the exposed Python plugin/SDK fields and matching CLI switches.
Defaults and constraints are **source-verified** in the
[plugin](../src/commands/python/index.ts), [Node adapter](../src/commands/python/node.ts),
[SDK](../../../src/sdk/bash.ts) and [CLI](../../../src/cli/commands/bash.ts).
Runtime acceptance of selected settings is recorded in the QA links below;
the table does not imply every numeric boundary was exercised with real Python.

| SDK/plugin field | CLI | Default / meaning |
| --- | --- | --- |
| `createWorker` | None | Required by plugin; SDK may instead use the Node fields below. Fresh dedicated worker per command; no interpreter pooling. |
| `trustedPython` | `--python-trusted` | Must be `true` for Node; includes imports and packages. |
| `runtimeModuleURL` | `--python-runtime URL` | Required for Node; explicit Pyodide module URL. |
| `indexURL` | `--python-index-url URL` | Module directory; runtime assets, outside installer policy. |
| `runtimeMount` | `--python-runtime-mount PATH` | `/.pyodide-runtime`; absolute top-level canonical path, reserved and read-only. Existing entry causes startup failure. |
| `maxTransferBytes` | `--python-max-transfer-bytes N` | 65,536; positive integer through 1,048,576. |
| `maxOpenFiles` | `--python-max-open-files N` | 256; positive integer through 1,048,576. |
| `maxConcurrentWorkers` | `--python-max-concurrent-workers N` | 4; integer 1–64, shared by aliases per plugin. Capacity fails immediately. |
| `maxInputChunkBytes` | `--python-max-input-chunk-bytes N` | 1,048,576; integer 1–16,777,216; bound on retained upstream fragments. |
| `onProgress` | Automatic stderr progress | `initializing`, `ready`, `finished` host events; separate from guest streams. |
| `replace` | None | `false`; plugin collision policy, omitted from `runBash.python`. |
| `packages` | `--python-package VALUE` (repeatable) | Requirement strings or canonical wheel paths; empty by default. |
| `requirements` | `--python-requirements PATH` (repeatable) | Canonical requirements files; empty by default. |
| `packageProfile` | `--python-package-profile documents` | No default profile; exact pins below. |
| `provisioning` | Installer switches below | Explicit package environment policy. |

`runBash` additionally takes `source`, `fs` or `root`, and `ShellExecOptions`
including `cwd`, `env`, `stdin`, `stdout`, `stderr`, `signal` and execution limits.
The CLI uses `--command`/`-c`, `--root` and `--cwd`; `--root` defaults to the host
cwd and `--cwd` to `/`. Supplying explicit roots makes the mount visible in the
invocation. SDK `fs` takes precedence over `root`; it needs at least one of them.
CLI Python options require `--python-runtime`; `--dry-run` is refused for `bash`.
The bridge also has fixed internal defaults of 65,536 entries per directory
listing and 1,024 canonical scope/device pairs per stat translator. These are
not exposed as `pythonCommands`/CLI tuning options; overflow is a refusal, not
silent truncation or an invented identity.

| `provisioning` field | CLI / default |
| --- | --- |
| `requirements` | Additional requirement strings combined with `packages`; no separate CLI field. |
| `requirementFiles` | Additional files combined with command `requirements`; no separate CLI field. |
| `profile` | `'documents'`; command `packageProfile` takes precedence. |
| `offline` | `--python-package-offline`; false by default. Missing remote artifacts fail. |
| `authorize`, `transport` | `--python-package-allow-origin ORIGIN` (repeatable) creates both; otherwise downloads require explicit SDK objects. |
| `cache` | Host-trusted async `get`/`set` byte store; no CLI equivalent. |
| `cacheDirectory` | `--python-package-cache PATH`; canonical path; mutually exclusive with `cache`. |
| `maxCacheBytes` | `--python-package-max-cache-bytes N`; 128 MiB, positive safe integer; built-in memory cache only. |
| `maxDownloadBytes` | 64 MiB per artifact; positive safe integer; SDK only. |
| `onProgress` | `download`, `cached`, `installed` events; CLI renders these to stderr. |

No safe-bash-specific Python or package environment variables configure these
options. The CLI forwards its exported host environment; SDK callers supply
`env`. The bridge explicitly handles `PYTHONPATH` (canonical module paths),
`PYTHONIOENCODING`, `PYTHONWARNINGS`, `PYTHONUNBUFFERED`,
`PYTHONDONTWRITEBYTECODE` and `PYTHONSAFEPATH`; `-E` and `-I` ignore Python
environment settings. Nonempty `PYTHONHOME` and `PYTHONINSPECT` fail unless
ignored or only help/version is requested. Other CPython startup environment
variables may reach the pinned runtime, but are **documentation-only/unqualified**
unless a launcher test names them. **Documentation-only:** standard-library `TMPDIR`, `TEMP` and `TMP`
select temporary directories through Python's normal discovery; make the selected
canonical directory writable, or use an existing canonical `/tmp`. This is not
a host temporary-directory mount.

Integration-only variables `SAFE_BASH_PYODIDE_RUNTIME_URL`,
`SAFE_BASH_NATIVE_PYTHON`, `SAFE_BASH_PYTHON_CACHE` and
`SAFE_BASH_PYTHON_ARTIFACT_DIR` select runtime/oracle inputs and capture destinations in the
manual QA routes. They do not configure `pythonCommands`, `runBash` or the CLI.

## Installation, local wheels and offline reuse

For the recipes below, configure `packageProfile: 'documents'` and a persistent
canonical cache, plus an explicit installer transport/authorizer for the first
installation. [Package environments](python-packages.md) records cache format,
all pins, integrity rules and resolver limitations. A CLI first-run example is:

```sh
node dist/bin.cjs bash --root /absolute/project \
  --python-trusted --python-runtime file:///absolute/runtime/pyodide.mjs \
  --python-package-profile documents --python-package-cache /python-cache \
  --python-package-allow-origin https://cdn.jsdelivr.net \
  --python-package-allow-origin https://pypi.org \
  --python-package-allow-origin https://files.pythonhosted.org \
  -c 'python report.py'
```

For another run with that fully populated cache and locally available runtime
assets, replace the three origin switches with `--python-package-offline`.
Keep the cache directory and profile. A fresh interpreter reconstructs its
site-packages from cached artifacts; Python globals and imported module mutations
are not reused. The in-memory default cache lasts only for one plugin instance;
`runBash` creates a new shell per call. Persistent stores must retain artifacts,
URL metadata and environment manifest together. Eviction or an incomplete cache
can cause offline failure even if a previous online invocation succeeded.

The configured shell also accepts explicit installations:

```sh
python -m pip install pypdf==6.18.1
python -m pip install -r /requirements.txt
python -m pip install /wheels/et_xmlfile-2.0.0-py3-none-any.whl
```

The wheel must exist in canonical storage; the filename above is an input
example, not a bundled asset. Local wheels require their full compatible
dependency closure and installer/runtime assets to be available offline.
Requirements files allow comments, blanks, markers, extras and relative wheel
paths; each file is bounded to 1 MiB. Nested `-r`, stdin `-r -`, options in the
file and line continuations are refused. The `pip` facade only supports `install`,
`-r`/`--requirement`, `-h`/`--help` and `--`. It does not run desktop pip or source
builds. Upgrade/uninstall, `--no-deps`, editable installs, custom pip indexes,
`--target`, `--no-index` and `--find-links` are not supported; configure installer
policy instead. Imports never silently install missing packages.

Native dependencies must be built for the selected Pyodide/Emscripten ABI:
**lxml 6.0.2** supplies libxml2/libxslt and **Pillow 12.2.0** supplies compiled
imaging code. A macOS/Linux/Windows wheel is not portable to Wasm. Pure Python
packages still depend on compatible native transitive dependencies. Installing
without dependencies is not a supported shortcut. The exact document profile is
python-docx **1.2.0**, openpyxl **3.1.5**, XlsxWriter **3.2.9**, pypdf **6.18.1**,
fpdf2 **2.8.8**, lxml **6.0.2**, Pillow **12.2.0**, fonttools **4.65.0**,
defusedxml **0.7.1**, et-xmlfile **2.0.0** and typing-extensions **4.16.0**.
Do not install legacy `fpdf` alongside `fpdf2`; they use the same import name.
PyMuPDF **1.27.2.2** is a separate historically tested optional native package,
not part of `documents`. A font file is also a separate canonical input.

| Failure | Diagnosis and next action |
| --- | --- |
| Missing import | Confirm explicit requirement/profile and installed version; imports do not invoke the installer. |
| Incompatible wheel / no matching distribution | Check Python/ABI/platform tags and exact pin; use a matching Pyodide native build or compatible pure wheel. No host pip fallback. |
| Authorization refusal or offline cache miss | Check the reported origin/URL and full dependency/cache closure. Authorize intended origins explicitly or populate offline inputs. |
| Hash mismatch / malformed cache | Restore trusted bytes or select a fresh cache. Do not bypass integrity checks. |
| Conflicting pins / changed manifest | Supply a compatible set; use a new environment for version changes. Retry concurrent installation after the other writer finishes. |
| `ENOTSUP`, `EROFS`, `EOVERFLOW` during document I/O | Inspect canonical descriptor/capability/metadata support. Package installation success does not imply the selected filesystem supports its native-library I/O. |
| Native loader or resource error only in an old root-mount capture | Compare its fixture/version with the later fixes. A historical namespace failure is not proof that the package itself is incompatible. |

Verified artifacts may remain cached after installation failure, but a failed
installation does not publish a new environment manifest. Hashes detect cache
corruption; host-trusted cache metadata is not signed provenance. Independently
created plugins/processes sharing one persistent store require a single writer.

## Runtime deployment and resource lifecycle

The interpreter runs on a dedicated worker event loop. Its synchronous
filesystem/stdio calls block on shared-memory request/reply while the host loop
awaits the canonical Promise-based backend and shell sinks. Never run both sides
on one event loop: that would prevent progress. Only the interpreter worker may
block in `Atomics.wait`. Node needs no HTTP isolation headers. A browser host
needs a secure, cross-origin-isolated page/worker with `SharedArrayBuffer`,
normally COOP `same-origin` and COEP `require-corp`, plus compatible CSP,
CORS/COEP and worker/runtime assets. Historical browser fixtures qualify their
specific setup; they are not a ready-made public browser adapter. Browser main
threads and workerd are not qualified deployments for this shared-memory route.
For an injected host, implement the `PythonWorkerEndpoint` message/error/
termination protocol and call `runPythonWorker` with the supplied startup
configuration on the worker side; the [worker protocol](../src/contracts/python.md)
contains the public imports and loader contract. Do not silently reuse one
interpreter for multiple endpoints.

Every accepted command owns a fresh interpreter and terminates it after success,
exception or cancellation. Module globals, Python cwd and module modifications
do not survive; canonical filesystem writes and the configured package environment
can survive. Up to four commands run concurrently by default; both aliases share
that plugin's slots. Exhaustion fails immediately rather than queueing a pipeline
stage behind another stage waiting for it. Independent plugins have independent
limits, so the host must also bound their number.

Stdin is pulled on demand; stdout/stderr acknowledgments await the destination
sink, preserving bounded-pipe backpressure. The shell's output/path/operation
limits remain distinct from Python bridge and package-cache limits. Cancellation
terminates CPU loops, imports, initialization and blocked interpreter requests;
it closes admission, drains cooperative admitted host work and retires descriptors
before settlement. Cleanup failure remains observable and retains its admission
slot. Cancellation cannot roll back completed effects or interrupt an arbitrary
host promise that never settles. A worker is never reused. `runBash` disposes its
shell in `finally`; explicit `Shell` users must do the same. See the
[lifecycle contract](../src/contracts/python.md#streaming-cancellation-and-lifetime)
for custom worker ownership. No hard CPU/heap/RSS/package-expansion bound or
hostile-Python sandbox follows from worker termination and buffer limits.

CPython finalization runs while canonical filesystem and stream RPC are still
available, so ordinary `atexit` callbacks can write files and buffered output.
The [shutdown edge qualification](../../../docs/plans/pyodide-shutdown-edge-qa.md)
checks reverse callback order, binary file bytes and nonzero `SystemExit` on the
built Node adapter. It also interrupts an `atexit` CPU loop and blocked stdin by
terminating the worker, retires retained handles and admits a successful next
command. Cancellation forcibly stops the interpreter; it does not guarantee
that remaining Python shutdown callbacks run or roll back pre-abort writes.

## Copyable synchronous document scripts

Save each block under the indicated filename in the canonical cwd; invoke it
with `python FILENAME`. These scripts need the exact `documents` profile above.
They use ordinary imports and file objects, without `await`, `run_sync`, shell
callbacks or application-tree copies. Their current execution/inspection results
are recorded in [usage finalization QA](../../../docs/plans/python-usage-finalization-qa.md);
historical library qualification below applies only to its recorded fixtures.

**Runtime-tested on 2026-09-13 against built public exports:** the complete SDK
example, all six command forms above, local `python -m report`, and all three
script blocks below passed on Pyodide 314.0.6 / CPython 3.14.2. All eleven
installed document-profile versions matched the exact pins. The three installer
commands also passed using preprovisioned cache inputs, the stated canonical
requirements file and the real et-xmlfile wheel; fresh imports succeeded with
zero package transport calls. This qualifies offline reuse, not a new online
download. Logs and artifact paths are retained in the linked QA record.

### DOCX: `docx_report.py`

```python
from pathlib import Path
from docx import Document

output = Path("report.docx")
document = Document()
document.add_heading("Quarterly report", level=0)
document.add_paragraph("Café results — created with python-docx 1.2.0.")
table = document.add_table(rows=1, cols=2)
table.rows[0].cells[0].text = "Item"
table.rows[0].cells[1].text = "Count"
row = table.add_row().cells
row[0].text, row[1].text = "Reports", "3"
document.save(output)
reopened = Document(output)
reopened.tables[0].cell(1, 1).text = "4"
reopened.save(output)
assert Document(output).tables[0].cell(1, 1).text == "4"
with output.open("rb") as handle:
    assert handle.read(2) == b"PK"
print(output.name, "reopened and edited")
```

This generates and edits OOXML; it does not paginate or render Word layout.
The broader qualified fixture adds images and stream/temporary-file round trips.

### XLSX: `xlsx_report.py`

```python
from pathlib import Path
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font
import xlsxwriter

output = Path("report.xlsx")
book = Workbook()
sheet = book.active
sheet.title = "Summary"
sheet.append(["Count", "Value"])
sheet.append([1, 7])
sheet.append([2, 3])
sheet["B4"] = "=SUM(B2:B3)"
sheet["A1"].font = Font(bold=True)
book.save(output)
book.close()
edited = load_workbook(output)
edited["Summary"]["B2"] = 9
edited.save(output)
edited.close()
check = load_workbook(output)
assert check["Summary"]["B2"].value == 9
assert check["Summary"]["B4"].value == "=SUM(B2:B3)"
check.close()
cached = load_workbook(output, data_only=True)
assert cached["Summary"]["B4"].value is None
cached.close()

with xlsxwriter.Workbook("writer.xlsx") as writer:
    sheet = writer.add_worksheet("Summary")
    sheet.write_row("A1", [7, 3])
    # The caller supplies 10; XlsxWriter does not calculate this formula.
    sheet.write_formula("C1", "=SUM(A1:B1)", None, 10)
cached = load_workbook("writer.xlsx", data_only=True)
assert cached["Summary"]["C1"].value == 10
cached.close()
print("report.xlsx edited; writer.xlsx cached result verified")
```

openpyxl **3.1.5** preserves formula expressions but does not calculate them.
XlsxWriter **3.2.9** creates workbooks; it does not edit existing ones or evaluate
formulas. Its optional cached result above is caller-provided. Subsequent edits
with openpyxl can remove caches. `data_only=True` reads stored caches, not fresh
calculations. Formula engines and Excel/LibreOffice recalculation are separate
workflows; external export results do not prove evaluation inside Pyodide.
Upstream references: [openpyxl formulas](https://openpyxl.readthedocs.io/en/stable/simple_formulae.html)
and [XlsxWriter formula results](https://xlsxwriter.readthedocs.io/working_with_formulas.html#formula-results).

### PDF: `pdf_report.py`

```python
from pathlib import Path
from fpdf import FPDF
from pypdf import PdfReader, PdfWriter

output = Path("report.pdf")
pdf = FPDF()
pdf.add_page()
pdf.set_font("Helvetica", size=16)
pdf.cell(text="Quarterly report")
pdf.add_page()
pdf.set_font("Helvetica", size=12)
pdf.cell(text="Second page")
pdf.output(str(output))
with output.open("rb") as source:
    reader = PdfReader(source)
    assert len(reader.pages) == 2
    assert "Quarterly report" in reader.pages[0].extract_text()
    writer = PdfWriter()
    writer.add_page(reader.pages[0])
    writer.add_metadata({"/Title": "Extracted report"})
    with open("first-page.pdf", "wb") as destination:
        writer.write(destination)
with open("first-page.pdf", "rb") as source:
    assert len(PdfReader(source).pages) == 1
print("report.pdf generated; first-page.pdf reopened")
```

fpdf2 **2.8.8** generates pages; pypdf **6.18.1** reads/extracts/manipulates them.
Neither is a page rasterizer. This minimal example uses standard Helvetica;
for Unicode beyond its encoding, provide a licensed canonical TTF and call
`pdf.add_font("Report", fname="/fonts/report.ttf")` followed by
`pdf.set_font("Report", size=12)`. The [public document QA](../../../docs/plans/python-public-documents-qa.md)
qualifies the specific JetBrains Mono font listed below and image embedding,
including independent `pdffonts` inspection. The generic
`/fonts/report.ttf` is a **documentation-only input example**, not a bundled font.
PyMuPDF rendering is runtime-tested only in the separately identified browser
fixtures below; no claim is made for arbitrary PDFs or the current Node recipe.
Word/Excel-to-PDF, OCR, external executables and office-suite conversion are not
implemented by these scripts. External renderers used for QA run on the host.

## Current compatibility and canonical filesystem matrix

Evidence labels: **R** = recorded real-runtime test (the cited profile only);
**U** = unit/contract test; **S** = source-verified behavior; **D** = upstream
documentation or untested candidate. Current manual runs and screenshot outcomes
are in [usage finalization QA](../../../docs/plans/python-usage-finalization-qa.md).
Historical browser results are not current Node/public-export acceptance.

| Python / CPython area | Scope and evidence |
| --- | --- |
| Language/runtime | R: CPython 3.14.2 on Pyodide 314.0.6. Other Python minor versions and Pyodide ABIs are unqualified and not interchangeable. |
| File, `-m`, `-c`, stdin, aliases, shebangs | R: built launcher/public integration and product-worker tests; ordinary synchronous scripts supported. |
| Startup flags | R/S: launcher tests cover native startup behavior. Supported `-B -E -P -O -OO -u -s -S -I -b -bb -d -v -q -R`, `-W`, help/version and `--`; `-X` only `utf8[=0|1]`, `dev`, `warn_default_encoding`, `int_max_str_digits=N` (0 or integer 640–2147483647). Remaining options fail status 2. |
| Exceptions and exit | R: Python exception/SystemExit behavior, byte output and flush failure (120); cancellation is host termination, not Python signal delivery. |
| Imports/packages | R: canonical local modules, package data, explicit requirements/local wheels and fresh-worker offline reconstruction. D: arbitrary third-party packages are not qualified by an import or name alone. |
| Subprocess/fork/exec | R: product blocks libc system routes; subprocess/fork fail in the pinned runtime. No native process fallback or desktop pip. |
| Threads/multiprocessing | R: thread creation raises RuntimeError. D: general Wasm threading/process limitations. Host interpreter workers do not implement Python threading. |
| TTY/signals | R/S: all standard streams are non-TTY; no interactive REPL, `-i`, terminal sessions, line editing or terminal signals. D: native resource/pty/fcntl/termios behavior is not qualified. |
| Network | R: ordinary native socket/API paths refused. S: authorized installer transport exists. D: requests/urllib3/JS transports are not a qualified guest network API; clearing globals does not prove mediation of all JS access. |
| Resource limits | R: blocked I/O/CPU/import/startup cancellation, concurrency and recovery. S: bounded bridge/cache settings. No hard CPU, Wasm heap, RSS or decompressed-package quota. |
| Documents | R: specific public DOCX/XLSX/PDF fixtures on memory/delayed storage; browser PyMuPDF separately. D: full office layout, recalculation, conversion and arbitrary document fidelity. |

The filesystem rows describe the **current Python bridge**, not just an adapter's
method inventory. [safe-fs Python contract](../../safe-fs/src/contracts/python.md),
`tests/python-filesystem.test.ts`, `tests/python-stat.test.ts` and
`tests/python-unlink.test.ts` in safe-fs supply U evidence;
[product-worker.test.mjs](../tests/integration/pyodide-runtime/product-worker.test.mjs)
and the built-public [command parity](../tests/integration/pyodide-runtime/public-command-parity.test.mjs),
[lifecycle](../tests/integration/pyodide-runtime/public-lifecycle.test.mjs) and
[documents](../tests/integration/pyodide-runtime/public-documents.test.mjs) cohorts
supply R evidence. Their skips/TODOs remain gaps, not passes.

| Capability | Current result and boundary |
| --- | --- |
| Canonical root/cwd/imports/temp | R: application files, local imports and `/tmp` reach canonical storage; bootstrap assets remain separately reserved/read-only. No workspace copy-in/out. |
| Ordinary `open`, `Path`, buffered/partial I/O | R: retained reads/writes, Unicode/spaces, >64 KiB transfers, delayed short reads/writes, seek/truncate and binary streams. Requires actual canonical `open`. |
| Retained identity | R/U: rename/unlink, duplicated descriptors/shared cursors and sparse writes preserve acquired objects. No pathname reopen emulation. |
| Append/exclusive creation | R/U: genuine append and atomic exclusive creation; existing files/directories/final symlinks refused. `O_NOFOLLOW` only with `O_CREAT|O_EXCL`; general no-follow is unsupported. |
| stat/lstat/fstat | R/U: Python projections preserve known fields; unknown optional fields are `None`. Unknown required identity fails EOVERFLOW; native C metadata requires representable numeric observations. Not native ABI parity for every backend. |
| Directory iteration | R/U: bounded `listdir`, context-managed `scandir`, `walk`/`iterdir`; lazy path metadata. Native retained directory descriptors and descriptor-relative stat are unsupported. |
| Removal/rename/links | R/U: strong unlink, empty-only rmdir and backend link/rename semantics; cross-backend rename refuses. Weak recursive rm or snapshot-marker removal cannot substitute. |
| Permissions/timestamps/sync | R/U: forward declared support; preserve EROFS/ENOTSUP and synchronization levels. No invented uid/gid enforcement, durability, fchmod/futimes or unknown metadata. |
| Memory and delayed memory | R: ordinary scripts and document fixtures; delay demonstrates asynchronous canonical service, not a deployed remote provider. |
| Rooted real storage | R: public filesystem/launcher checks; only the explicit root is exposed through the bridge. Host confinement against hostile JS recovery remains unproven. |
| Readonly and mounts | R/U: selected-path authority/refusals remain; mounts do not turn unsupported backends into descriptor stores. |
| Quota, overlay, S3, WebDAV | S/U: general retained `open` may refuse ENOTSUP. No bypass to underlying storage. Quota-backed document success remains an open priority requirement; remote deployment/document behavior is unqualified. |
| Atomic staging/conditional mutations | S: no ordinary Python syscall equivalent or general transaction guarantee. Python ZIP saves do not inherit the shell archive command's staged publication contract. |

The detailed mapping and capability inventory below retain design requirements
and earlier findings. They do not override this current evidence matrix.
Full compliance remains **open**: quota-backed priority document workflows,
backend-specific descriptor/metadata fidelity, interactive TTY behavior, process/
thread compatibility, complete guest host/network confinement and hard resource
limits are not established. Honest ENOTSUP preserves optional canonical contracts
but does not make an affected document workflow pass. Keep those failures and
TODOs visible; do not close them because memory or browser controls pass.

## Historical implementation and qualification record

The remainder preserves earlier evidence and design inventories, including
their then-current blockers and command-not-found observations. These records
describe the specific tests, fixtures and stages they name; they are not a
chronological declaration of today's feature status. The current usage guide and
evidence matrix above supersede old statements that no Python command exists,
that every filesystem mapping is only proposed, or that provisioning is absent.
Later passes do not erase earlier failures or certify untested backends. Read
the dates, runtime profile and source manifests before reusing a result.
In particular, the old mapping table's `rm`-to-`os.unlink` proposal is historical:
the current service requires strong canonical `fs.unlink` and never falls back
to `fs.rm`, even when a nonrecursive `rm` option is available.

### Runtime hardening and then-current trust boundary

The current worker runner uses a fresh dedicated interpreter for every accepted
command. Worker termination is the cancellation mechanism, including synchronous
CPU loops, imports, initialization and `Atomics.wait` during stream/filesystem
requests. It does not depend on cooperative Python awaits or a verified
interpreter interrupt buffer. Host cleanup still follows the shell's cooperative
resource contract: an uncooperative backend promise can delay settlement, and
completed writes are not rolled back. See the [command contract](../src/contracts/python.md#streaming-cancellation-and-lifetime)
for exact admission, streaming and cleanup ownership.

The default per-plugin concurrency limit is four workers, shared by `python`
and `python3`. Capacity exhaustion fails immediately rather than queuing a
consumer behind a producer waiting for that consumer. Each accepted worker owns
one request/reply slot; independent workers share the asynchronous host service
loop and the caller's canonical filesystem. Interpreter globals and module state
are isolated; concurrent filesystem mutations retain the backend's own semantics
and are not a transaction. A custom factory must not multiplex these invocations
onto one interpreter or the host service event loop.

Bridge transfers default to 64 KiB and retained upstream stdin fragments to
1 MiB; oversized input fragments fail before the bridge copies them. Guest
stdout/stderr are bytes, with acknowledgments delayed until the sink accepts
each chunk. This bounds bridge buffering and preserves pipeline backpressure;
it does not bound an upstream producer's existing allocation or Python's own
whole-input reads. The built-in package cache defaults to 128 MiB/1024 entries,
protects its environment manifest and evicts artifacts; each installer session
retains only one opened artifact and closes it after transfer. See
[package cache ownership](python-packages.md#scope-cache-identity-conflicts-and-integrity).

No enforced instruction count, hard Python CPU limit, WebAssembly heap limit,
RSS quota, package-expansion limit or hostile-code sandbox is advertised.
Worker termination is an externally controlled lifetime boundary, not proof of
memory isolation or filesystem/network confinement. Hosts needing hard limits
must provide and qualify an independently enforced deployment boundary.

`runPythonWorker` supplies an empty null-prototype `jsglobals` to `loadRuntime`.
This removes accidental ambient globals from ordinary `import js`, provided the
trusted loader honors the supplied configuration. Pyodide documents that
`jsglobals` selects the object exposed through that module in its
[JavaScript API](https://pyodide.org/en/314.0.6/usage/api/js-api.html).
The pinned runtime also exposes `pyodide_js.mountNodeFS`, `useNodeSockFS`, `FS`
and internal module objects even with empty `jsglobals`, as verified by a
read-only presence probe. Clearing `js` alone does not remove these paths. The product loader therefore
refuses `mountNodeFS`, `mountNativeFS` and `useNodeSockFS`, removes the exposed
NODEFS backend, and intercepts the pinned libc system/socket imports before
instantiation. Startup fails if the required syscall hooks were not observed.
These interventions block ordinary native/API routes; they do not prove that JS proxies, callbacks, runtime internals or imported
packages cannot recover host capabilities. The Node adapter consequently
requires `trustedPython: true`; the CLI requires `--python-trusted` alongside
`--python-runtime`. Trust includes imported modules and installed packages.

Canonical filesystem restrictions describe calls through the Python filesystem
bridge. Installer authorization describes package transport through the host
installer bridge. Neither policy claims to mediate every possible JS call, and
the runtime asset loader has separate trusted host authority. A worker alone
cannot make hostile Python safe to run with privileged Node access. No ambient
host filesystem is intentionally mounted and no native process fallback is
provided, but these choices are not a security proof.

The initial hardening qualification is recorded in the [implementation and validation record](../../../docs/plans/pyodide-runtime-hardening.md): 136 focused Python units, 21 SDK/CLI units, and 78 explicit real-runtime checks across product-worker, document/provisioning and built-launcher suites passed. The subsequent [user edge review](../../../docs/plans/pyodide-hardening-edge-qa.md)
adds simultaneous pipelines, sibling cancellation isolation, early consumer
closure and failure recovery. It fixes cancellation starvation from empty stdin
fragments, startup after endpoint failure, and oversized cache-record publication.
These are working-tree results, not release or universal compatibility claims.

### Native Python differences

The pinned runtime is CPython compiled for Emscripten. Its Node embedding can
still expose native host operations; platform assumptions require actual probes. The following inventory is a compatibility boundary, not a list of
passing native-equivalence checks. Upstream describes the platform restrictions
in [Python compatibility](https://pyodide.org/en/314.0.6/usage/wasm-constraints.html),
[thread/process FAQ](https://pyodide.org/en/314.0.6/usage/faq.html#can-i-use-threading-multiprocessing-subprocess)
and [native-build migration](https://pyodide-build.readthedocs.io/en/latest/how-to/migrate.html).

| Area | Actual scope |
| --- | --- |
| `subprocess`, `os.system`, `os.popen`, fork/exec | The stock pinned Node runtime implements `os.system` with a native host shell: the qualification probe `os.system("exit 73")` returned 18688. The product loader now replaces that libc import with `ENOSYS`; WebAssembly alone did not prevent it. Measured `subprocess.run` and `os.fork` refused execution with runtime errors. |
| `threading`, `multiprocessing`, pthreads | Thread/process creation is unavailable in this runtime. Pure bookkeeping or directly calling a target function is not concurrent execution. Use independently admitted commands for actual worker concurrency. |
| Sockets and networking | Creating a `socket.socket()` succeeds in the pinned runtime; that is not proof of transport behavior. Its runtime contains WebSocket and optional Node socket backends. The product loader now refuses native socket creation/connect/bind/listen/send imports and the public Node socket-enabling API. Python HTTP libraries may select JS transport paths with different semantics. The plugin provides installer transport only, not a general guest-network capability or mediation guarantee. |
| Signals, terminals, process/resource APIs | No interactive TTY or terminal-control contract. `resource`, `fcntl`, `termios`, `pty`/`tty` and process signals differ or are unavailable; desktop resource-limit APIs do not enforce guest quotas here. |
| Native extension wheels | Only matching Pyodide/Emscripten builds can load. Desktop platform wheels and subprocess/source builds are unsupported. |
| Filesystem and metadata | Canonical descriptors/capabilities govern application paths. Unavailable native stat fields, directory descriptors, optional operations and backend refusals remain visible; no native POSIX filesystem parity is claimed. |
| Documents | In-process DOCX/XLSX/PDF/image libraries are supported only by their qualified workflows. They need no subprocess fallback; office-suite conversion, external renderers and thread-dependent library paths are separate unsupported workflows. |

The real-runtime native regression now observes `os.system` and `ctypes` calls
to libc `system` returning `-1` after interception, with the checking command
completing successfully. Socket construction now raises `OSError`, and thread
creation raises `RuntimeError`. The stock result above is retained as the reproduced defect,
not current product support. The loader restores its temporary WebAssembly
instantiation wrappers after initialization; these wrappers must run only on the
dedicated interpreter event loop. Package loading callbacks are retired after
provisioning, so ordinary user code cannot invoke the installer again through
`pyodide_js.loadPackage`. This still does not seal private runtime state.

Unit doubles cover bridge admission, byte ownership, cache retention and cleanup
ordering. Real-runtime interruption and document cases remain explicit opt-in
integration checks, outside unit discovery. Historical browser/MEMFS results
below qualify their recorded fixtures only; they do not certify current Node
hardening, every backend, every library or hostile-code safety.

## Earlier product user review: 2026-09-13

At this earlier review, the optional product-worker integration passed **17/17 tests**, with
no failures or skips, on Node **v22.23.2** and Pyodide **314.0.6**. Run:

```sh
node --import tsx --test packages/safe-bash/tests/integration/pyodide-runtime/product-worker.test.mjs
```

This review added ordinary-script checks for duplicated descriptors and shared
cursors, sparse writes and truncate, cleanup after an uncaught exception,
symlink-sensitive initial worker cwd, delayed three-byte reads/writes and append,
mounted storage, readonly mutation errors and cross-backend rename refusal.
The existing tests also cover imports, temporary files, retained rename/unlink,
metadata, bounded binary pipes and cancellation during blocked I/O.

Failing regressions exposed three defects, now corrected: initial mount cwd
was normalized before canonical resolution; a throwing unsubscribe callback
prevented worker and filesystem cleanup; cancellation during worker creation or
subscription still allowed interpreter startup. Fast Python command tests pass
15/15; canonical descriptor/Python filesystem checks pass 109/109. Public export
and browser bundle tests pass 41/41. The selected workspace build and maintained
source/public-consumer typechecks pass. Browser bundle checks do not execute a
browser interpreter, and these results do not qualify every extension library.

Shell constructor/exec cwd options normalize lexically before command dispatch.
The initial worker-cwd test therefore uses a direct command context retaining
the original operand; it does not claim to change the shell's existing cwd
policy. See the [review record](../../../docs/plans/python-fs-user-review.md)
for scope and executed checks. These are working-tree results, not a commit,
published package or release.

## Synchronous I/O boundary and deployment alternatives

### Fresh scoped qualification — 2026-09-16

Tested the working tree based on HEAD
`06fac91e776c2c56c8a1ad9036ebaca60f55d67a`, with the existing optional adapter,
Pyodide **314.0.6**, CPython **3.14.2**, and Node **22.22.2**. This is local
qualification, not a release or full acceptance. The normal `npm run build`
succeeds. No production Python or filesystem code changed.

| Executed scope | Result |
| --- | --- |
| Ordinary synchronous script on canonical memory and 1ms-delayed storage | Both pass, 166 backend operations each: open/pathlib/os/zipfile, random access, seek/tell, temporary files, local imports, read-after-write and retained rename identity. |
| Bounded shell pipes, incremental binary streams, blocked-stream cancellation | 13/13 pass in `stdio-proof.test.mjs`; high-water mark is one byte. |
| Delayed blocked filesystem read cancellation | Pass; parent event loop remains live and one retained handle closes. |
| Built public command parity against native CPython 3.14.2 in Bash | 56/56 pass, including both aliases, files/modules/stdin, arguments, status/tracebacks, binary redirects/pipes, shebangs and invocation isolation. Native oracle: Darwin, Bash 3.2.57. |
| Selected built public lifecycle/authority checks | 11 passes, one failing quota TODO, zero unexpected failures/skips. Memory/delayed mounts and readonly effects, descriptor metadata refusal, setup recovery, cancellation and output exhaustion are covered. |
| Canonical Python translation and retained quota unit checks | 118/118 pass using in-memory fixtures. This does not qualify writable quota descriptors. |
| Promise-returning native read callback | Invalid on Node 22.22.2 and Node 24.21.0 with stack switching: both Python entry modes read empty bytes rather than the supplied bytes. |
| Supported `run_sync` suspension experiment | Node 24.21.0's promising Python-entry control passes; native read callback re-entry fails with `NoGilError: Attempted to use PyProxy when Python GIL not held`. Explicit experiment exits 1; not an acceptance pass. |

The new retained-metadata public regression passes on both backends without a
production fix: `os.fchmod`/`os.fchown` return ENOTSUP after rename/replacement,
both objects retain their modes, retained truncate succeeds, and handles close.
The quota acceptance TODO still fails at `Path('/quota/input').read_text()` with
ENOTSUP. Its wrapper intentionally refuses canonical `open`; retained resize
support alone does not provide byte writes. Implementing writable quota handles
requires alias-aware retained growth admission, append/cursor observation,
cancellation and retirement coordinated with the wrapper's mutation queue.
Bypassing it or reopening paths would weaken its existing contract.

To repeat these scopes from the repository root:

```sh
npm ci --prefix packages/safe-bash/tests/integration/pyodide-runtime --ignore-scripts
npm run build
node --import tsx packages/safe-bash/tests/integration/pyodide-runtime/verify.mjs 0
node --import tsx packages/safe-bash/tests/integration/pyodide-runtime/verify.mjs 1
node --import tsx packages/safe-bash/tests/integration/pyodide-runtime/cancel-fs.mjs
node --import tsx --test packages/safe-bash/tests/integration/pyodide-runtime/stdio-proof.test.mjs
# Provision the native oracle outside tests, then select its exact executable.
uv python install 3.14.2
SAFE_BASH_NATIVE_PYTHON="$(uv python find 3.14.2)" node --test packages/safe-bash/tests/integration/pyodide-runtime/public-command-parity.test.mjs
node --test --test-name-pattern='retained metadata|required Python quota|composed authority|quota refusal|setup failure|cancellation and output' packages/safe-bash/tests/integration/pyodide-runtime/public-lifecycle.test.mjs
node packages/safe-bash/tests/integration/pyodide-runtime/promise-callback.mjs
npx --yes --package=node@24.21.0 node --experimental-wasm-stack-switching packages/safe-bash/tests/integration/pyodide-runtime/promise-callback.mjs
# Negative experimental route: fresh process only; expected exit 1.
npx --yes --package=node@24.21.0 node --experimental-wasm-stack-switching packages/safe-bash/tests/integration/pyodide-runtime/promise-callback.mjs --suspension
```

The suspension probe reports a passing control before the callback blocker.
Native Python releases the GIL during file I/O; calling a Python PyProxy from
that Emscripten callback is invalid even when `can_run_sync()` is true. An errno
recovery attempt also produced fatal Wasm memory access failure; restoring FS
callbacks does not establish interpreter recovery. This adaptation is not a
deployment design. Direct suspension of Wasm syscall imports or a custom runtime
build remains unqualified; this result does not prove every suspension design
impossible. Cloudflare/workerd remains unsupported by the Node bridge.

Document package workflows, general no-follow acquisition, retained directories,
all-provider metadata fidelity, hard resource limits and guest confinement were
not freshly qualified by this scoped run. Browser deployment still requires the
isolation/asset policies below; no fresh browser or Cloudflare execution was
performed. Full contract/deployment acceptance stays open in the plan.

Emscripten's filesystem callbacks are synchronous. A Promise returned from
`lookup`, `getattr`, `read`, or `write` is not an awaited filesystem operation.
The same applies to Pyodide's byte-oriented standard-stream callbacks.
[Emscripten filesystem API](https://emscripten.org/docs/api_reference/Filesystem-API.html)
and [Pyodide streams](https://pyodide.org/en/stable/usage/streams.html) document
these interfaces.

| Deployment | Assessment |
| --- | --- |
| Pyodide worker, custom Emscripten mount, shared-memory request/reply | Implemented and runtime-tested in the optional Node adapter. Only the interpreter worker blocks in `Atomics.wait`; the async filesystem and shell pipe service runs on another event loop. This does not qualify every backend or browser deployment. |
| Pyodide and Promise backend on one thread, ordinary callbacks | Invalid: blocking prevents backend promises from progressing; returning a Promise supplies the wrong return value. |
| JSPI stack suspension | `run_sync` works in a promising Python entry on the pinned runtime/Node 24 control. Calling that Python API from a native Emscripten read callback fails with `NoGilError`; see the fresh qualification below. Direct suspension of Wasm syscall imports or another build remains unqualified. |
| Asyncify/custom Pyodide build | Requires a separately built and qualified runtime and suspension coverage of the relevant imports; this is not a capability implied by stock Pyodide. |
| Pinned runtime with syscall/path adaptation | Can potentially preserve raw path operands before Emscripten traversal and replace metadata ABI conversion. This requires qualification of every affected syscall, retained descriptor, import and extension-library route; a Python-only `open` patch is insufficient for C library filesystem calls. No such build or complete interception is yet qualified. |
| NODEFS/NATIVEFS/IDBFS/WORKERFS | These select different storage or synchronization interfaces; none forwards arbitrary canonical Promise-based safe-fs wrappers and retained descriptors. They cannot replace the caller's filesystem. |
| MEMFS copy-in/copy-out | Rejected: hides intermediate writes, breaks retained identity, quotas, mounts, concurrent visibility and incremental files. |
| Cloudflare workerd | The shared-memory worker bridge is unavailable: the platform does not support Wasm threads. A separately verified suspension-based integration would be needed. This is a context restriction, not evidence that all deployments are impossible. |

The upstream [JSPI explanation](https://blog.pyodide.org/posts/jspi/) explicitly
distinguishes synchronous Python entry points from promising ones. Feature
detection and the actual runtime experiment take precedence over assuming that
an engine version supports stack suspension.

A browser worker/shared-memory deployment needs a secure, cross-origin-isolated
environment permitting `SharedArrayBuffer`, ordinarily COOP `same-origin` and
COEP `require-corp` (or the applicable credentialless deployment). Runtime assets
and worker scripts must satisfy CSP, CORS/COEP and asset loading policy. Node
workers do not need browser HTTP isolation headers. Browser main-thread blocking,
service-worker lifetimes, worklets, and non-isolated pages are not qualified
execution contexts. See [shared-memory deployment requirements](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer).

## Canonical filesystem mapping

The authority is `safe-fs/src/contracts/filesystem.ts`, `descriptor.ts` and
`filesystem.md`; safe-bash reexports that same contract. Every operation must run
against the command's scoped filesystem, preserve cancellation and backend errors,
and use selected-path capabilities where available. Required method presence
does not mean guaranteed support: canonical methods may reject `ENOTSUP`.
The table specifies the necessary mapping, not proof of implementation.

| Mandatory member | Python/Emscripten mapping and preservation rule |
| --- | --- |
| `capabilities` | Preserve three states (true, false, unknown); no method-presence inference; `readOnly` overrides mutation. |
| `readFile` | Whole-file utility reads only when bounded; ordinary Python file reads use retained descriptors. Never make import discovery require a whole-tree preload. |
| `writeFile` | Path create/overwrite utility, with exact `w/wx/a/ax`, mode and signal semantics; cannot substitute for descriptor writes. |
| `appendFile` | Genuine path append if requested; not replacement-file emulation and not a retained append handle. |
| `stat` | Following path metadata for `os.stat`/`Path.stat`; preserve known fields and errors. |
| `lstat` | Non-following metadata for `os.lstat`/`Path.lstat`; must not collapse final symlinks. |
| `readdir` | `os.listdir`, `scandir`, import directory discovery; forward a per-listing `maxEntries`, reject overflow rather than truncate. |
| `mkdir` | `os.mkdir`; `os.makedirs` may use repeated admitted operations. Preserve mode, explicit parent creation and intermediate effects. |
| `rm` | Not used as a substitute for Python unlink: even nonrecursive rm lacks the required atomic refusal of a raced directory. Python requires optional canonical `unlink`. |
| `rename` | `os.rename`/`replace`, subject to backend semantics and cross-mount refusal; do not claim atomicity unless supplied. |
| `copyFile` | Backend copy primitive where explicitly selected; normal `shutil` reads/writes need not call it. No unsafe alias inference before destructive opens. |
| `realpath` | Canonical path resolution through actual mount/symlink policy; lexical normalization is not authority. |
| `access` | `os.access` policy probe; no promise a later operation succeeds and no invented uid/gid enforcement. |

| Optional member | Mapping or truthful refusal |
| --- | --- |
| `open` | Required for general retained Python file objects; translate access, creation, truncation, append, mode and requested synchronization without widening authority. Use command descriptor enrollment. |
| `capabilitiesFor` | Query the actual selected path, including requested creation/directory intent; do not substitute a global positive declaration for a path refusal. |
| `canonicalizeMissingTarget` | Host-side missing-path helper only; preserve undefined/unknown and do not treat its string as a namespace authorization. |
| `openReadFile` | Optional retained-read-only route; preserve `allowDirectory`, `stat/read/seekEnd/close` and resource identity. Does not grant writable descriptors. |
| `openResizeFile` | Optional retained resize route; preserve `stat/truncate/seekEnd/close`, creation and mode. Does not grant byte writes. |
| `resizeFile` | Atomic path resize with the exact bigint operation; no `stat` plus write approximation and no retained-handle substitution. |
| `compareEntry` | Keep the original filesystem peers in the service realm; same/distinct/unknown remains point-in-time, not a lease. |
| `rmdir` | `os.rmdir` only with strong empty-only semantics. Refuse missing support or the weaker snapshot-marker profile. |
| `unlink` | `os.unlink`/`remove` requires atomic final-entry removal refusing every directory; absent support returns ENOTSUP. |
| `readlink` | `os.readlink` preserves raw target text. |
| `symlink` | `os.symlink`, subject to actual link support. |
| `link` | `os.link`, preserving backing identity and mount restrictions; do not copy bytes. |
| `chmod` | `os.chmod` only with actual permissions support; advisory modes cannot claim enforcement. |
| `utimes` | `os.utime`, preserving supported precision and errors; no invented timestamps. |
| `truncate` | Path-based `os.truncate`; descriptor `ftruncate` must use the retained object. |
| `readStream` | Optional incremental source; preserve chunk ownership and cancellation. It is not a seekable retained descriptor by implication. |
| `writeStream` | Optional incremental sink; preserve explicit stream semantics. Do not infer retained identity from ordinary streaming. |
| `writeFileConditional` | No ordinary Python syscall equivalent; withhold any atomic conditional guarantee unless forwarded intact. |
| `removeFileConditional` | No ordinary syscall equivalent; never degrade to check-then-delete. |
| `removeEntryConditional` | No ordinary syscall equivalent; keep expected parent/entry authority service-local and do not emulate atomic removal with a pathname check. |
| `prepareDirectory` | No ordinary syscall equivalent; atomic directory metadata guarantee stays unavailable unless explicitly integrated. |
| `createStagedFile` | No ordinary syscall equivalent; staging receipts and committed ownership must remain service-local. |
| `publishStagedFile` | No ordinary syscall equivalent; never claim Python ZIP publication is the shell ZIP command's atomic staging route. |
| `removeStagedFile` | No ordinary syscall equivalent; cleanup is receipt-bound, nonrecursive and must survive cancellation when enrolled. |

## Capability inventory

All declared optional flags are accounted for below. Undeclared extension flags
from the string index signature remain unknown and cannot enable bridge behavior.

| Flags | Required behavior |
| --- | --- |
| `open`, `readOnly` | Admit actual descriptor support and enforce readonly before creating or mutating. |
| `read`, `stat`, `readdir`, `realpath`, `access` | Preserve inspection declarations independently. |
| `write`, `append`, `exclusiveCreate` | Distinguish ordinary mutation, direct append and atomic exclusive creation; temporary files require real exclusive creation. |
| `explicitDirectories`, `implicitDirectories`, `mkdir`, `recursiveMkdir` | Preserve directory representation and creation limits; prefixes do not imply writable parents. |
| `remove`, `removeDirectory`, `recursiveRemove`, `snapshotRmdir` | Keep file deletion, empty directory deletion and recursive deletion distinct. Snapshot markers do not satisfy POSIX empty-directory removal. |
| `rename`, `atomicRename`, `atomicRenameNoReplace` | Preserve the selected backend's primitive and exact no-replace guarantee, never check-then-rename. |
| `copy`, `exclusiveCopy` | No upgrade from ordinary to exclusive copy. |
| `readlink`, `symlinks`, `hardlinks`, `permissions`, `timestamps` | Expose only actual supported operations; failure is observable in Python. |
| `truncate`, `retainedResize`, `atomicResize` | Three distinct paths; neither path resizing nor atomic resizing establishes an open object's retained identity. |
| `streamingRead`, `retainedRead` | Streaming and retained reads are independent; seekability is not implied by streaming. |
| `streamingWrite`, `streamingAppend`, `descriptorWriteStream` | Preserve separate overwrite, append and pinned-resource assertions. |
| `randomAccessWrite`, `independentWriteStreams` | Neither guarantees descriptor positioning or shared cursors. No whole-file offset replacement for Python handles. |
| `atomicFileStaging`, `atomicFileMutation`, `atomicEntryRemoval`, `atomicDirectoryMetadata` | No ordinary Python syscall equivalent. Do not advertise corresponding transactional behavior without integrating the full canonical receipt/conditional operation. |

## Descriptors, identity and budgets

`FileDescriptor.stat/read/write/truncate/sync/close` must address the same acquired
object after rename, unlink and pathname replacement. `read` and `write` return
actual byte counts, including partial and zero progress. Numeric offsets are
nonnegative safe integers and do not move the backend cursor; null offsets do.
Python seeking may maintain an interpreter-side logical offset only while
performing genuine positioned operations against that retained descriptor.
Append writes require the backend's genuine append operation; EOF guesses cannot
replace its cursor observation. `fstat` must never reopen a path.

| Descriptor capability | Admission |
| --- | --- |
| `position`, optional `getPosition` | Require both affirmative support and callable observation; never infer append position from current file size. |
| `readObservation`, optional `probeRead` | Preserve ready/blocked/unknown without consuming bytes; not blanket `select`/`poll` support. |
| `openTruncate` | Independent of subsequent `truncate`; absent falls back to descriptor truncate support per canonical contract. |
| `positionedRead`, `positionedWrite` | Respect access masking; nonseekable numeric operations fail `ESPIPE`. |
| `positionedAppendWrite` | Explicit affirmative permission for real offset-preserving writes on append handles; ordinary append remains separate. |
| `delegateZeroLengthWrite` | Forward explicit empty writes when required; preserve errors and queue/cleanup semantics. |
| `truncate` | Retained writable resize only; cursor and identity survive. |
| `synchronization` | Preserve none/volatile/storage. Volatile flush is not durable storage; unsupported requested guarantees fail before destructive acquisition. |

Opaque `identityScope` objects/symbols cannot be JSON serialized or freshly cloned
as canonical identities. Keep identity comparisons and conditional receipts in
the service realm. Any numeric translation for Python `st_dev/st_ino` needs a
stable, collision-free mapping of complete scoped tuples; unknown identity must
not become an invented same-file/distinct-file guarantee. Preserve optional stat
allocation, block-size, revision, uid/gid, link-count and device fields without
fabricating backend guarantees.

Use the invocation's scoped filesystem for the shared operation/path budget.
`openCommandFile` enrolls retained resources and counted descriptor output;
bypassing it with a raw underlying filesystem would evade shell output accounting.
Register cleanup before acquisition, stop admission on abort, drain admitted
cooperative work, close late acquisitions and keep the original cancellation
reason in the host. An errno sent to Python must not replace host cancellation
provenance. Worker termination does not cancel or roll back an already-dispatched
backend mutation. Opaque, uncooperative work cannot promise bounded retirement.

For stdin/stdout/stderr, exchange bounded owned byte chunks. A read request must
pull only needed input, and an output acknowledgement must await the shell sink
so bounded pipes apply backpressure. One service loop must remain free to advance
both directions. Buffered source-from-stdin consumes that stream as source;
script-file and `-c` invocations leave stdin for program data. Final command
settlement must drain output and owned handles. Wall-clock cancellation is not
a Python instruction-step or WASM-memory quota.

## Current preservation blockers and qualification gaps

Canonical quota, overlay, S3 and WebDAV implementations explicitly refuse general
`open` because their existing accounting/object model cannot preserve arbitrary
retained descriptor writes. A mount containing one of these backends must preserve
the refusal. Memory and rooted-real descriptor support does not establish support
for every canonical filesystem. In particular, replacing a quota view with its
underlying memory store would bypass the user's policy. Readonly and mounts must
forward their own retained authority, never unwrap the caller's view.

Pinned runtime integration evidence below qualifies synchronous worker/RPC I/O,
ordinary filesystem libraries, immediate memory and delayed backend runs,
retained file handles, bounded bidirectional pipes and blocked-I/O cancellation.
Remaining architecture qualification covers the complete canonical root namespace,
metadata ABI fidelity, capability isolation, unsupported open flags, descriptor
synchronization and full shell-command lifecycle/budget integration. There is no
registered `python` or `python3` command yet. The task remains open: these
experiments establish transport feasibility, not a completed feature or proof
that full preservation is impossible.

Optional descriptor refusal alone is not a blocker to contract preservation:
the user permits truthful unsupported optional guarantees. It is a restriction
on the available Python operation for that backend. An implementation must report
that restriction instead of claiming every canonical filesystem can run every
Python file operation. Platform thread constraints are documented by
[Cloudflare's Wasm runtime](https://developers.cloudflare.com/workers/runtime-apis/webassembly/).

## Pinned runtime observations

The isolated integration dependency pins **Pyodide 314.0.6**. The metadata/path
probe was executed with **Node v22.23.2**, without JSPI flags, using
`node packages/safe-bash/tests/integration/pyodide-runtime/metadata-path-probe.mjs`.
It is a real stock-runtime characterization, not custom canonical-mount evidence.

The runtime's `SYSCALLS.writeStat` stores device, uid/gid, mode, link count and
rdev as unsigned 32-bit integers; inode and size use signed 64-bit stores;
allocation blocks use a signed 32-bit store. It hardcodes `st_blksize` to 4096.
The experiment supplied a custom node stat and observed:

| Supplied observation | Python result |
| --- | --- |
| `dev = 2**32 + 7` | `st_dev = 7` |
| `ino = 2**40 + 9` | `st_ino = 1099511627785` (preserved) |
| `uid = 2**32 + 11` | `st_uid = 11` |
| `blksize = 16384` | `st_blksize = 4096` |
| `blocks = 2**32 + 13` | `st_blocks = 13` |
| `mtime = new Date(1234.75)` | `st_mtime_ns = 1234000000` (Date loses fractional milliseconds) |

Consequently a mount callback alone cannot transparently forward every valid
canonical metadata value. Before product admission, unrepresentable values must
fail closed with Python `EOVERFLOW` or use a qualified wider bridge; silent wrapping is
unacceptable. Unknown optional canonical fields
cannot simply become zero and then support Python same-file comparisons. Scope
mapping must distinguish identities without silently misreporting provider IDs.
The forced block-size value requires deeper runtime adaptation if that field is
to preserve the provider's observation. These are concrete stock-runtime gaps;
they do not prove that a custom build or carefully qualified interception cannot
resolve them.

The current canonical `FsError` code union does not include `EOVERFLOW`.
A bridge-side ABI validation error must map directly to the Python/Emscripten
errno or extend the canonical error contract with its own tests; it must not
claim that existing filesystem providers already expose that code.

The same experiment demonstrates that `open('/probe-metadata/')` and
`open('/probe-metadata/.')` both read the regular file successfully. The pinned
`FS.lookupPath` drops empty components and skips `.`; backend callbacks no longer
receive the original terminal syntax. A plain custom mount cannot recover it.
The runtime does process symlinks before `..`, so a blanket assertion that all
symlink paths are lexically normalized would be inaccurate. Correct integration
must preserve the original operand before runtime path traversal, including final
separator, dot components and mount/symlink authority; these requirements remain
unqualified. Internal runtime mount names must not alter absolute user symlinks
or expose a second writable namespace that evades canonical policy.

Pyodide's Python/JavaScript interoperability is also a separate trust boundary.
A worker and a filesystem mount alone do not prove host isolation: qualification
must account for guest access to JavaScript globals, runtime loaders, native Node
bindings and network APIs. Loading trusted interpreter assets is not permission
for guest programs to read arbitrary host files. Filesystem-routing experiments
must not be described as proof of that broader isolation property.

### Incremental pipe evidence

On the same pinned runtime and Node version,
`node --import tsx --test packages/safe-bash/tests/integration/pyodide-runtime/stdio-proof.test.mjs`
passes **4/4** real-runtime cases. The positive case exchanges 64 binary input
bytes through actual bounded shell pipes with high-water mark 1; the producer
waits for Python stdout and stderr before supplying the next input byte. It
therefore exercises bidirectional progress without precollecting stdin. Separate
cases abort while Python waits for stdin, stdout or stderr and verify RPC work
retirement and interpreter worker termination before settlement.

This qualifies that transport experiment in Node worker threads. It does not
qualify a registered `python` command, browser deployment, arbitrary host promises,
or the custom filesystem mount's complete semantics.

### Host capability probe and deployment alternatives

`node packages/safe-bash/tests/integration/pyodide-runtime/host-capability-probe.mjs`
loads the pinned runtime inside a Node worker and executes ordinary Python
`import js`. On Node **v22.23.2**, Pyodide **314.0.6**, presence checks returned
`process=true`, `getBuiltinModule=true`, `fetch=true`, and `Function=true`.
The probe does not request a native module, read a host file, or launch a process.
Nevertheless, exposing `js.process.getBuiltinModule` means this stock deployment
does not satisfy safe-bash's prohibition on implicit guest host-file/native-process
access. A worker isolates execution scheduling; it is not this capability boundary.

The following alternatives remain deployment work, not verified replacements:

| Alternative | Assessment |
| --- | --- |
| Stock Node worker with `jsglobals` restricted | The option changes the Python `js` module's object, but does not establish a complete isolation guarantee for runtime interop, callable constructors, loaders or other exposed objects. Requires adversarial qualification; not admitted. |
| Node `vm` realm with explicitly injected runtime assets | Asset injection can remove ambient loader dependencies, but Node explicitly documents that `node:vm` is not a security mechanism. A realm alone is insufficient for an untrusted guest. |
| Dedicated browser worker on an isolated origin with restrictive response CSP | Candidate without Node native bindings. Requires cross-origin isolation for shared memory, explicit runtime assets, worker-response CSP restricting network/script/child-worker capabilities, and qualification of storage and other browser authority. The later browser document qualification below verifies isolated browser execution, but does not qualify restrictive CSP or the guest capability boundary. Asset bootstrap and restrictive network policy must be solved together. |
| Separately isolated service/process with an authenticated narrow RPC capability | Can provide an external host boundary, but adds deployment infrastructure and needs independent qualification. A native Python subprocess is not an implementation of the requested Pyodide feature. |

Sources: [Pyodide `jsglobals` documentation](https://pyodide.org/en/0.28.2/usage/api/js-api.html),
[Node VM security limitation](https://github.com/nodejs/node/blob/main/doc/api/vm.md),
[worker cross-origin isolation](https://developer.mozilla.org/en-US/docs/Web/API/WorkerGlobalScope/crossOriginIsolated),
and [CSP worker sources](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/worker-src).
The older versioned Pyodide documentation describes the option; the pinned
runtime's installed declarations also expose it. It is not evidence of isolation.

### Canonical wrapper regression evidence

`mount-regressions.test.mjs` exercises actual canonical adapters through the
experimental bridge. Verified cases include read-only write refusal with original
bytes preserved; a four-byte memory quota refusing a fifth byte; nested mount
writes reaching the mounted backend; and `scopeFileSystem` rejecting operation
13 against a twelve-operation allowance. A separate exhausted-budget case rejects
a truncating open while preserving the original file bytes. These establish those specific refusal
and delegation paths, not general Python support under every quota or capability.

The retained `fstat`, retained `ftruncate`, and append-after-seek cases initially
failed, then passed after descriptor-backed runtime hooks were added. The cached
file-to-directory replacement regression also passed after interception bypassed
the runtime node cache. These are experimental runtime changes, not proof that a
plain custom mount preserves the complete contract. The absolute-symlink case
remains a full-contract assertion: the initial mount silently wrote into MEMFS;
later interception still requires a complete canonical root namespace.

The actual canonical quota wrapper, `withFileSystemQuota`, advertises
`capabilities.open=false`. Its real-runtime refusal test confirms a truncating
Python open raises Emscripten ENOTSUP (138), preserving original bytes. This is
truthful refusal, not Python descriptor support through that wrapper.

A separate identity regression seeds two mounted `MemoryFileSystem` instances
with equal numeric `dev` and `ino` but distinct `identityScope` values. The initial
RPC/stat mapping collapses these scopes and Python `os.path.samefile` incorrectly
returns true. This is a demonstrated contract violation requiring stable scoped
identity translation; JSON cannot preserve an object/symbol identity by itself,
and missing identity must not be replaced with a fabricated shared zero identity.


### Filesystem bridge and stack-suspension verification

The isolated integration dependency is pinned by `package.json` and lockfile to
**Pyodide 314.0.6**, reporting **CPython 3.14.2**. From the repository root:

```sh
npm ci --prefix packages/safe-bash/tests/integration/pyodide-runtime --ignore-scripts
node --import tsx packages/safe-bash/tests/integration/pyodide-runtime/verify.mjs 0
node --import tsx packages/safe-bash/tests/integration/pyodide-runtime/verify.mjs 1
node --import tsx packages/safe-bash/tests/integration/pyodide-runtime/cancel-fs.mjs
node packages/safe-bash/tests/integration/pyodide-runtime/promise-callback.mjs
npx --yes --package=node@24.21.0 node --experimental-wasm-stack-switching packages/safe-bash/tests/integration/pyodide-runtime/promise-callback.mjs
```

Both filesystem runs pass on Node **22.23.2**. Delay zero directly awaits canonical
`MemoryFileSystem` methods; delay one inserts a one-millisecond timer before every
backend operation. A synchronous ordinary `/work/ordinary.py` is read from the
injected filesystem and executed using `runpy.run_path`. It exercises `open`,
`pathlib`, `os`, `zipfile`, `tempfile`, a local module import, seek/tell, positioned
writes, read-after-write and a retained open file across rename and replacement.
All work files and the ZIP archive remain in the same canonical filesystem.
The worker waits with `Atomics.wait`; backend promises run on the live parent
thread. No work-tree copying or filesystem replacement occurs in this passing
mount-scoped proof. A blocked delayed-read cancellation probe also passes and
verifies exactly one retained handle is closed.

The negative callback probe writes known bytes into the supplied buffer, returns
a delayed Promise resolving to the byte count, then exercises both `runPython`
and `runPythonAsync`. Both return empty Python bytes instead of `actual`.
Node **24.21.0** with the flag reports `can_run_sync() == True`; Node **22.23.2**
without it reports False. Thus verified JSPI availability does not make ordinary
Emscripten filesystem callbacks await Promise returns. This is a characterization
of the invalid callback approach, not a passing Python I/O implementation.
A separate API adaptation or supported suspension entry is still required.

The initial retained-descriptor regressions failed before the experimental
`stream_ops.getattr` and `stream_ops.setattr` hooks were added. The pinned runtime
supports those hooks and the corrected cases pass. Its original `FS.open`
precreates and truncates through path callbacks before calling `stream_ops.open`,
and strips exclusive/truncation flags. The experiment therefore intercepts
`FS.open` and constructs streams around one canonical `open` operation;
`O_NOFOLLOW` is explicitly refused. This uses pinned runtime internals and needs
continued upstream compatibility qualification. Mount-only callbacks are not
being claimed sufficient. The proof also bypasses stale mount-node lookup cache
entries while retaining the bootstrap mountpoint.

A separate exploratory command remains failing:

```sh
node --import tsx packages/safe-bash/tests/integration/pyodide-runtime/verify.mjs 1 --root-mount
```

It remounts the original bootstrap graph under `/.pyodide-runtime`, replaces the
root with the canonical filesystem, and rewrites `/lib` entries in `sys.path`.
It gets through local imports and ordinary file writes, but later ZIP-library
work still requests `/lib/python314.zip` through cached runtime/module paths.
That original absolute path no longer exists in the canonical root. The proof
then encounters missing `/dev` while reporting failure. Preserving the graph
without copying is feasible; relocating every runtime assumption, retaining
stdio devices, making the bootstrap view read-only, and handling reserved-path
collisions are **unqualified**. Adding only another mount at `/tmp` would not
solve arbitrary canonical absolute symlinks. This failed root experiment must
not be presented as proof of full canonical namespace support or impossibility.

## Initial integration gate (before user edge review)

Root verification on Node 22.23.2 confirms both ordinary-script backend runs,
blocked-filesystem-read cancellation, and all four bounded pipe cases. The final
`mount-regressions.test.mjs` run reports **10 passed, 2 failed, no skips**: the
absolute-symlink and distinct-identity-scope assertions still fail. Run it with:

```sh
node --import tsx --test packages/safe-bash/tests/integration/pyodide-runtime/mount-regressions.test.mjs
```

This command intentionally exits nonzero while the required semantics remain
unimplemented. The metadata and Promise-callback probes characterize failures;
their successful assertions are not successful contract-preservation tests.
No runtime benchmark is part of default unit discovery. The explicit entry-point
inventory check passes without loading Pyodide.

Production command parsing (`-c`, script, stdin and `-m`), argv/environment,
library deployment, complete namespace and scoped identity translation, truthful
metadata conversion, a qualified guest capability boundary, and end-to-end Shell
output-budget/cleanup integration remain open. The scoped operation-budget and
pipe controls do not stand in for that complete Shell integration. No README,
production dependency, public export or default command registry was changed.

## User edge review, September 13, 2026

The manual review is recorded in
[`docs/plans/pyodide-user-edge-review.md`](../../../docs/plans/pyodide-user-edge-review.md).
Actual source-API `Shell` invocations with `agentCommands()` return exit 127 and
`command not found` for both version aliases, script files, `-c`, `-m`, and piped
source. These are missing required workflows, not successful Python tests.

New failing regressions exposed five bugs in the separate stdio experiment:
output pipes remained open after Python completed; downstream closure became
generic EIO instead of `BrokenPipeError`; a large write lost its accepted-prefix
count when the consumer closed during backpressure; and buffered text disappeared
without an explicit guest flush; and Pyodide's exception formatter consumed
buffered stderr into the JavaScript exception text. The bridge now closes output endpoints after
completion, preserves canonical errno, returns the accepted prefix, and attempts
both stream flushes in Python before an exception crosses into JavaScript,
retaining an earlier script failure. This is not full
interpreter shutdown or `atexit` support.

Filesystem identity translation now keeps opaque scope tokens in the parent
service and assigns guest device numbers per scoped canonical device. Known
aliases retain equality and disjoint scopes remain distinct. This translation
is invocation-local; guest device numbers are translated identifiers rather than
the provider's numeric device field. Unknown identities and complete metadata
fidelity still need qualification. The filesystem bridge also uses the pinned
runtime's errno table instead of turning unlisted canonical errors into EIO.

Additional regressions reproduced destructive acceptance of `O_SYNC`, false
`fsync` success, and a duplicated descriptor losing its retained object when its
peer closed. The experiment now refuses `O_SYNC`/`O_DSYNC` before acquisition,
delegates `fsync` to the canonical descriptor, and reference-counts duplicated
streams while preserving their shared offset. Canonical volatile synchronization
still does not promise durable storage. This does not qualify every CPython open
flag or descriptor operation.

The filesystem and stdio experiments still use separate workers. A passing
filesystem script and passing pipe script do not prove their composition.
Independent review found ordinary `print(..., flush=True)` in the filesystem
worker attempts Pyodide's default Node stdout path and fails with EIO. That worker
has no shell-backed stdio configuration. Production lifecycle, CLI statuses,
source modes, flags, environment, package provisioning and guest isolation remain
unimplemented. The full feature remains **open**.

Final independent reruns on Node **v22.23.2**, Pyodide **314.0.6**, CPython
**3.14.2**:

| Verification | Result |
| --- | --- |
| `stdio-proof.test.mjs` | 11 passed, 0 failed, 0 skipped |
| `mount-regressions.test.mjs` | 17 passed, 1 failed, 0 skipped |
| `verify.mjs 0` and `verify.mjs 1` | Both passed, 166 canonical operations each |
| `cancel-fs.mjs` | Passed, one retained handle closed after blocked-read cancellation |
| Pyodide opt-in inventory test | Passed without loading the runtime |
| Edited JavaScript syntax checks | Passed |

The remaining mount assertion fails with `FileNotFoundError` for
`/work/link/shared` when `/work/link` targets canonical `/tmp`. A custom `/work`
mount still cannot provide the complete canonical namespace. The failing test
remains enabled and the suite exits nonzero. Earlier metadata, Promise-callback
and host-capability characterizations were also reproduced; their failures have
not been repaired. This review changed experimental helpers, integration tests
and documentation only; it is not a production build or release gate.

## Browser document qualification

This qualification uses the same pinned **Pyodide 314.0.6** in a real browser
worker. The primary candidates are `python-docx` (`docx`), `openpyxl`,
`XlsxWriter` (`xlsxwriter`), `pypdf`, and **`fpdf2`** (`fpdf`). The legacy
distribution named `fpdf` is not an interchangeable dependency. Matching
Pyodide-built `lxml` and `Pillow` must load before compatible pure-Python wheels
are installed with micropip dependency resolution enabled. Desktop Python
imports, package-index entries, and import-only browser checks do not qualify
these workflows.

The same ordinary Python script must run first against MEMFS as a control, then
against the experimental canonical filesystem bridge with immediate and delayed
backend operations. The bridge's `/work` scope remains a limitation. Successful
document round trips there do not resolve absolute canonical symlinks, runtime
namespace collisions, metadata fidelity, or the full shell lifecycle.

Historically, before the opt-in Python plugin landed, the source shell was checked with a canonical in-memory
`/work/document.py`: both `python document.py` and `python3 document.py` return
**127**, with `command not found`. Package qualification is a prerequisite for
implementation. This historical result does not describe current main: register
`pythonCommands({ createWorker })` to enable the implemented public commands.
XLSX formula preservation is separate from recalculation, and DOCX editing is
separate from Word layout or conversion to PDF.

### Pinned installation inputs

The selected [314.0.6 package index](https://cdn.jsdelivr.net/pyodide/v314.0.6/full/pyodide-lock.json)
declares CPython **3.14.2**, Emscripten **5.0.3**, wasm32 ABI **2026_0**.
Its matching native wheels are `lxml 6.0.2`, `Pillow 12.2.0`, and
`PyMuPDF 1.27.2.2`; its installer is `micropip 0.11.1`. These index facts
identify inputs, not passing runtime results.

The browser worker loads the runtime from
`https://cdn.jsdelivr.net/pyodide/v314.0.6/full/pyodide.mjs`, with the matching
`indexURL`. Package loading must use that index, not desktop native wheels.
[Pyodide's package-loading documentation](https://pyodide.org/en/stable/usage/loading-packages.html)
distinguishes matching native builds from pure-Python wheels and documents
micropip's dependency resolution. Qualification retains `deps=True`.

Exact installation calls in the browser worker:

```javascript
const pyodide = await loadPyodide({
  indexURL: 'https://cdn.jsdelivr.net/pyodide/v314.0.6/full/'
});
await pyodide.loadPackage(['micropip', 'lxml', 'pillow']);
// Evaluated separately; failure must not prevent the primary package probes.
await pyodide.loadPackage('pymupdf');
```

The pure-Python installation runs through `pyodide.runPythonAsync`:

```python
import micropip
await micropip.install([
    'python-docx==1.2.0',
    'openpyxl==3.1.5',
    'XlsxWriter==3.2.9',
    'pypdf==6.18.1',
    'fpdf2==2.8.8',
    'fonttools==4.65.0',
    'defusedxml==0.7.1',
    'et-xmlfile==2.0.0',
    'typing-extensions==4.16.0',
], deps=True)
```

The asynchronous installer is setup code. The document script itself uses
ordinary synchronous library and filesystem APIs and executes with
`runpy.run_path('/work/documents.py', run_name='__main__')`. It does not replace
public `python FILE` dispatch. Each profile uses a fresh worker;
package-cache reuse across shell invocations is not qualified here.

### Package licenses and native requirements

These are the selected versioned distribution declarations and build requirements;
optional extras are not enabled by this profile. The browser results below determine
which operations actually work. No library is installed as a production dependency
of safe-bash by this qualification.

| Distribution | License | Runtime/build dependency relevant to this profile |
| --- | --- | --- |
| [python-docx 1.2.0](https://pypi.org/project/python-docx/1.2.0/) | MIT | Pure Python; requires lxml and typing-extensions. |
| [openpyxl 3.1.5](https://pypi.org/project/openpyxl/3.1.5/) | MIT | Pure Python; et-xmlfile; Pillow for images. |
| [XlsxWriter 3.2.9](https://pypi.org/project/XlsxWriter/3.2.9/) | BSD-2-Clause | Pure Python; ZIP and temporary-file support from CPython. |
| [pypdf 6.18.1](https://pypi.org/project/pypdf/6.18.1/) | BSD-3-Clause | Pure Python for the exercised unencrypted PDFs; optional cryptography extras are outside this profile. |
| [fpdf2 2.8.8](https://pypi.org/project/fpdf2/2.8.8/) | LGPL-3.0-only | Pure Python; Pillow, fonttools and defusedxml; an embeddable font file. |
| [lxml 6.0.2](https://pypi.org/project/lxml/6.0.2/) | BSD-3-Clause | Compiled extension backed by libxml2/libxslt; use the matching Pyodide wheel. |
| [Pillow 12.2.0](https://pypi.org/project/Pillow/12.2.0/) | MIT-CMU | Compiled imaging extension; PNG requires zlib. Other codec/font features depend on the actual build. |
| [PyMuPDF 1.27.2.2](https://pypi.org/project/PyMuPDF/1.27.2.2/) | AGPL-3.0 or Artifex commercial license | Native MuPDF engine and Python binding, supplied by the selected Pyodide wheel; evaluated separately from the primary package set. |
| [fonttools 4.65.0](https://pypi.org/project/fonttools/4.65.0/) | MIT | Compatible pure-Python wheel; font parsing/subsetting for fpdf2. |
| [defusedxml 0.7.1](https://pypi.org/project/defusedxml/0.7.1/) | PSFL | Pure Python. |
| [et-xmlfile 2.0.0](https://pypi.org/project/et-xmlfile/2.0.0/) | MIT | Pure Python. |
| [typing-extensions 4.16.0](https://pypi.org/project/typing-extensions/4.16.0/) | PSF-2.0 | Pure Python. |

The [lxml build requirements](https://lxml.de/installation.html) and
[Pillow native-library requirements](https://pillow.readthedocs.io/en/stable/installation/building-from-source.html)
describe their underlying libraries; a desktop wheel containing those libraries
does not make it compatible with Wasm. Optional shaping, encryption and additional
image codecs are not qualified by a PNG/font embedding test.

Pyodide 314.0.6 and the installer
[micropip 0.11.1](https://pypi.org/project/micropip/0.11.1/) are MPL-2.0;
CPython carries its PSF license and bundled component notices. The font fixture is the existing
`packages/terminal-png/assets/jetbrains-mono-400-normal.ttf`, distributed under
the [JetBrains Mono SIL Open Font License 1.1](https://github.com/JetBrains/JetBrainsMono/blob/master/OFL.txt).
Its exact bytes are bound in the final capture's source manifest.

### Reproduced failures and experimental adaptations

The captures are under
[`tests/integration/pyodide-runtime/browser-documents/captures`](../tests/integration/pyodide-runtime/browser-documents/captures).
Earlier captures remain unchanged:

- Attempts 01–02: browser `TextDecoder` rejects a `SharedArrayBuffer`-backed
  view. Attempt 02's MEMFS document workflows pass while the bridge fails on
  its first stat reply. The browser adaptation copies each reply before decoding.
- Attempt 03: ordinary Python reads preserve a 98,560-byte file, but the
  artifact collector's Emscripten `FS.readFile()` call returns only the first
  64 KiB through this short-read bridge. Parent canonical byte comparison exposes
  the mismatch. Artifact capture now uses Python `Path.read_bytes()`, which loops
  over short reads. General `FS.readFile()` compatibility remains unresolved.
- Attempts 03–04: `NamedTemporaryFile`, openpyxl save, and XlsxWriter packaging
  fail with Emscripten `ENOTSUP` (138) because CPython temporary-file creation
  includes `O_NOFOLLOW`. DOCX, fpdf2/pypdf and PyMuPDF pass on the scoped bridge.
- Attempt 05: recursive artifact capture follows the new regression's dangling
  symlink and masks its report with a generic exception. Attempt 06 fixes the
  collector to skip symlinks and retain collection errors separately, then
  captures the failing exclusive-create assertions before the semantic change.
- Attempt 06: fresh and existing exclusive/no-follow opens all return 138;
  expected outcomes are fresh creation and `EEXIST` (20) for existing entries.
  Both immediate and delayed bridge runs retain these failures.

The browser fixture now admits `O_NOFOLLOW` **only with both `O_CREAT` and
`O_EXCL`**. Canonical `creation: 'exclusive'` already promises atomic refusal of
every existing final entry, including symlinks. Exclusive opens go directly to
canonical acquisition instead of a preliminary following stat, preserving refusal
for directories and dangling/self-loop symlinks. All nonexclusive `O_NOFOLLOW`
opens remain unsupported. At attempt 07 this was a narrow experimental browser
adaptation; the original Node worker still refused `O_NOFOLLOW`. The edge review
below subsequently moves the same exclusive-create handling into the shared worker.

This does not establish general no-follow support, complete syscall coverage,
or production architecture admission. The separate root-mount profiles still
exercise unresolved runtime namespace relocation. Their native-library and
resource-loading errors must not be presented as package incompatibility when
the same packages work on MEMFS and the scoped canonical bridge.

### Earlier measured result: attempt 07

The final capture uses a real **Chrome 153.0.8010.36** browser worker, with both page and
worker reporting `crossOriginIsolated: true`, **Pyodide 314.0.6** and **CPython
3.14.2**. The CDN package-index SHA-256 is
`3fdaef09e9e365c85e002737720f8d0ab8f278c1c244a2dde6a37663cf488ad4`.
The [source manifest](../tests/integration/pyodide-runtime/browser-documents/captures/attempt-07/source-hashes.json)
binds the fixture, inherited bridge, served browser bundle (including canonical
filesystem implementation), served worker and font. It describes the tested
working-tree inputs, not a committed or published release.

The exact browser version is retained in
[`browser-version.json`](../tests/integration/pyodide-runtime/browser-documents/captures/attempt-07/browser-version.json).
The [browser result screenshot](../../../output/playwright/pyodide-documents-attempt-07.png)
was inspected, as was the PyMuPDF-rendered page: its accented text and embedded
blue image are visible. This is PDF rendering evidence, not DOCX/XLSX visual-layout
validation. The owned browser session and loopback server were closed after capture.

| Workflow | MEMFS control | Canonical `/work` | Canonical `/work`, 1ms delay per operation |
| --- | --- | --- | --- |
| File I/O, seek, Unicode/spaces, BytesIO, named temporary files | Pass | Pass | Pass |
| Pillow PNG write/reopen | Pass | Pass | Pass |
| Exclusive/no-follow creation and existing-entry protection | Pass | Pass | Pass |
| python-docx create/edit/reopen | Pass | Pass | Pass |
| openpyxl create/edit/reopen | Pass | Pass | Pass |
| XlsxWriter create, openpyxl read | Pass | Pass | Pass |
| fpdf2 generation and pypdf round trips | Pass | Pass | Pass |
| PyMuPDF rendering and structured extraction | Pass | Pass | Pass |

The first seven rows are the seven independently reported assertion groups;
PyMuPDF is evaluated separately. See the raw
[MEMFS](../tests/integration/pyodide-runtime/browser-documents/captures/attempt-07/memfs.json),
[canonical](../tests/integration/pyodide-runtime/browser-documents/captures/attempt-07/bridge.json),
and [delayed canonical](../tests/integration/pyodide-runtime/browser-documents/captures/attempt-07/bridge-delayed.json)
reports. Each canonical run performs **3,713 backend operations**, ends with
**zero open handles**, and checks **14 captured files byte-for-byte** against
the parent-owned canonical filesystem, with no mismatches. Runtime assets and
packages stay in their bootstrap storage; application files are not copied into
MEMFS for the bridge runs.

Artifact assertions in [`documents.py`](../tests/integration/pyodide-runtime/browser-documents/documents.py):

- DOCX: save/reopen/edit heading text and style, Unicode paragraphs, table cells
  and image width; reopen through BytesIO; verify ZIP CRCs, document XML, table,
  image reference and media/relationship parts.
- openpyxl: create/reopen/edit numeric values, dates, formulas and styles;
  preserve date formatting, images, chart and drawing parts; reopen through
  BytesIO. `data_only=True` yields no computed formula result.
- XlsxWriter: create two formatted sheets, dates, a formula, frozen panes,
  image and chart; read them with openpyxl and verify ZIP parts; exercise
  temporary-file packaging and BytesIO generation. The cached value **22** is
  supplied explicitly to `write_formula`, not calculated by either library.
- PDF: fpdf2 produces three pages with an embedded TTF and image; pypdf verifies
  Unicode text, metadata, image stream bytes and embedded font stream bytes.
  Split page two, merge it back to make four pages, then reopen and check page
  order, text and retained font/image streams; also round-trip through BytesIO.
- PyMuPDF: reopen the generated PDF, extract structured text and image blocks,
  and render page one to a **298 × 421 PNG**. This qualifies the tested PDF
  rendering/extraction path, not arbitrary document conversion or OCR.
- Filesystem: a **98,560-byte** binary file, reads/writes across the 64 KiB
  transport boundary, end-relative seek, truncate, temporary-file reopen/unlink
  and directory cleanup. Explicit exclusive creation preserves regular files,
  existing directories, and dangling/regular/directory/self-loop symlinks.

The runtime reports libxml2 **2.9.10**, libxslt **1.1.33**, and Pillow native
features FreeType **2.13.3**, WebP **1.2.2**, JPEG **9.0**, zlib **1.3.1** and
libtiff **4.4.0**. Those reported build features are not all individually tested
codecs. The default temporary directory is `/tmp`; this qualification explicitly
sets `tempfile.tempdir` and XlsxWriter's `tmpdir` under canonical `/work`.

**ReportLab was not evaluated:** fpdf2 satisfies every requested generation
feature in the control and scoped canonical runs. Namespace failures in the
root-mount experiment are not evidence of a missing PDF generation feature.

### Reproduce and remaining gates

For current reruns, follow the [manual qualification steps](../../../docs/plans/pyodide-document-current-qa.md).
From the repository root:

```sh
npm ci --prefix packages/safe-bash/tests/integration/pyodide-runtime --ignore-scripts
node packages/safe-bash/tests/integration/pyodide-runtime/browser-documents/server.mjs NEW_CAPTURE_ID
```

Open `http://127.0.0.1:8766/` in Chromium, wait for all four profiles, and inspect
the reports and artifacts. Use a fresh capture identifier. This is an explicit
real-runtime integration experiment: it downloads assets and writes evidence.
It is outside normal `.test.ts` unit discovery. The maintained opt-in inventory
check only reads the manifest and fixture entry points:

```sh
node --test --test-name-pattern='Pyodide real-runtime verification' packages/safe-bash/scripts/integration-inputs.test.mjs
```

That focused check and the three browser JavaScript syntax checks pass; they do
not load a runtime, download wheels, or create host files. This work does not
claim a production build, commit, push or release.

The earlier [full-root capture](../tests/integration/pyodide-runtime/browser-documents/captures/attempt-07/root-bridge.json)
is failing: only the filesystem and exclusive-create groups pass. Pillow
raises `src/_imaging.c:196: bad argument to internal function`; openpyxl and
XlsxWriter encounter lxml returning NULL without an exception; PDF generation
cannot import `importlib.resources` from the cached `/lib/python314.zip` path.
DOCX and PyMuPDF then lack their image/PDF inputs. The later edge review below
diagnoses and fixes these failures in the browser fixture.

At the time of this historical qualification, required production work included `python FILE`/`python3 FILE`, canonical
root and default-temp namespace routing, complete filesystem semantics, shell
stream/lifecycle integration, package provisioning/reuse, and the browser guest
capability boundary. The scoped document workflows are runtime-qualified inputs
to that work. The optional Node implementation now supplies commands, root/temp
routing, provisioning and lifecycle controls; the current matrices and fresh
qualification below retain the remaining acceptance gaps.

## Document edge review: 2026-09-13, final capture user-edge-05

The historical manual review extended the real browser-worker qualification.
Full production acceptance remains open; optional Node Python support exists.
All packages, dependency-resolution calls and exact versions above are unchanged.
Chrome reports **153.0.8010.36**, Pyodide **314.0.6**, CPython **3.14.2**; page
and worker are cross-origin isolated. The index hash remains
`3fdaef09e9e365c85e002737720f8d0ab8f278c1c244a2dde6a37663cf488ad4`.
The final [source manifest](../tests/integration/pyodide-runtime/browser-documents/captures/user-edge-05/source-hashes.json)
binds the actual served bundle, worker, script, bridge, and font.

### Reproduced defects and fixes

- `user-edge-01` repeats the prior scoped passes and root failures.
- `user-edge-02` adds document stream/error/timestamp checks; those pass on
  MEMFS and the scoped immediate/delayed bridge, while root native/resource
  failures persist.
- Root relocation changed `sys.path` but left imported package metadata and
  native-loader identities pointing at `/lib`. Loading the relocated Pillow/lxml
  extensions again duplicated native state. The browser fixture now aliases
  relocated native-library names to the same existing library objects and rebases
  loaded module/spec paths. `user-edge-03` then passes the document workflows and
  PyMuPDF at root, but the new resource check fails with
  `can't find module 'importlib'`: existing ZIP loaders still retain old paths.
- Reconstructing known ZIP/source/bytecode/extension loader objects with relocated
  paths fixes that reproduced resource failure. `user-edge-04` passes all profiles;
  `user-edge-05` adds the canonical-root namespace checks below and also passes.
- Shared experimental `worker.mjs` now owns its RPC reply bytes and supports
  `O_NOFOLLOW` only with atomic `O_CREAT|O_EXCL`, previously browser-only fixes.
  Browser serving no longer rewrites those semantics independently.
- `os.utime` previously reported success without changing either timestamp.
  Emscripten supplies separate `atime`/`mtime` attributes; the bridge incorrectly
  inspected `timestamp`. The regression failed first and now checks both Python
  and canonical metadata. Browser checks also verify `shutil.copy2` preserves mtime.
- Two new stdio regressions reproduced shutdown failures when a valid script
  closes stdout/stderr or assigns them `None`. Final flushing now skips those
  streams while retaining existing error and buffered-output behavior.

These are experimental fixes. The browser relocation uses the pinned private
`_module.LDSO.loadedLibsByName` structure; it does not qualify arbitrary runtime
versions. Old native-loader aliases remain, the bootstrap mount reserves
`/.pyodide-runtime`, and complete loader/cache/capability isolation is not proven.
No canonical `/lib` is hidden behind a runtime mount, and user files are not
copied into MEMFS. The Node fixture retains its older root-relocation behavior.

### Final browser evidence

| Profile | Assertion groups | PyMuPDF | Parent byte comparisons | Backend operations | Open handles |
| --- | --- | --- | --- | --- | --- |
| MEMFS control | 11/11 | Pass | Not applicable | 0 | 0 |
| Canonical `/work` | 11/11 | Pass | 18/18 | 4,787 | 0 |
| Canonical `/work`, 1ms delay | 11/11 | Pass | 18/18 | 4,787 | 0 |
| Canonical root | 12/12 | Pass | 20/20 | 5,857 | 0 |

Raw reports: [MEMFS](../tests/integration/pyodide-runtime/browser-documents/captures/user-edge-05/memfs.json),
[scoped](../tests/integration/pyodide-runtime/browser-documents/captures/user-edge-05/bridge.json),
[delayed](../tests/integration/pyodide-runtime/browser-documents/captures/user-edge-05/bridge-delayed.json),
[root](../tests/integration/pyodide-runtime/browser-documents/captures/user-edge-05/root-bridge.json).
All have no script/collection errors and no canonical byte mismatches. PyMuPDF
is checked separately from `priority_passed`. The counts are measured cleanup
observations, not a general leak-freedom guarantee.

Additional checks cover DOCX through retained `w+b` handles and rolled-over
`SpooledTemporaryFile`; all 150 rows of openpyxl write-only/read-only and
XlsxWriter constant-memory output; pypdf retained input/output handles; empty and
corrupt DOCX/XLSX/PDF/PNG errors, input-byte preservation, and successful reopening
after those errors; timestamps; and `importlib.resources` reads from already-loaded
ZIP packages and python-docx. The root-only group checks default named temporary
files under `/tmp`, an absolute symlink out of `/work`, and a canonical user file
under `/lib`. The parent independently compares the `/tmp` and `/lib` bytes.
The scoped profiles still explicitly configure temporary storage under `/work`.

The [browser summary screenshot](../../../output/playwright/pyodide-user-edge-05.png)
and root-profile rendered PDF page were inspected: accented text and the embedded
blue image are visible. The screenshot summarizes actual captured results; it
does not demonstrate DOCX/XLSX layout or a public Python CLI. Formula storage and
explicit cached values still do not establish recalculation. ReportLab remains
unneeded for the requested generation features.

### Checks and remaining required workflows

The explicit real-runtime commands used the existing isolated pinned install:

```sh
node packages/safe-bash/tests/integration/pyodide-runtime/browser-documents/server.mjs user-edge-05
node --import tsx --test packages/safe-bash/tests/integration/pyodide-runtime/mount-regressions.test.mjs
node --import tsx --test packages/safe-bash/tests/integration/pyodide-runtime/stdio-proof.test.mjs
node --import tsx packages/safe-bash/tests/integration/pyodide-runtime/verify.mjs 1
node --import tsx packages/safe-bash/tests/integration/pyodide-runtime/cancel-fs.mjs
node --test --test-name-pattern='Pyodide real-runtime verification' packages/safe-bash/scripts/integration-inputs.test.mjs
```

Open the server in Chromium and wait for all four profiles; use a new capture ID
for each rerun. Real browser checks download runtime/package assets and persist
evidence; they remain outside unit discovery. JavaScript syntax checks and the
focused opt-in inventory check pass without downloading assets or writing host
files. Stdio integration passes **13/13** with no skips; delayed ordinary-script
and blocked-read cancellation checks pass. Mount integration passes **19/20**:
the scoped Node mount still fails the absolute-symlink-outside-`/work` assertion.
It opens the canonical target but then resolves it through runtime MEMFS. That
failing assertion is preserved; the separately qualified browser-root path does
not certify or silently fix the Node fixture.

Historical `Shell({ fs, cwd: '/work' }).use(agentCommands())` checks of
`python "document café.py"`, its `python3` alias, `python -c`, `python -m json.tool`,
and piped source to `python -` all still return **127**, `command not found`.
That configuration still intentionally omits Python. Current callers must also
register `pythonCommands({ createWorker })`; the public Node integration suites
exercise that implemented opt-in. Complete canonical filesystem fidelity,
unsupported flags and metadata ABI, guest capabilities and full lifecycle
acceptance remain open.
This review does not claim every edge case, a production build, commit, push,
or release.

## Fresh document qualification — 2026-09-16

Executed against the working tree based on `06fac91e776c2c56c8a1ad9036ebaca60f55d67a`,
with existing edits preserved. [Manual QA](../../../docs/plans/pyodide-document-current-qa.md)
uses the existing browser fixture, not a desktop Python oracle. The actual
browser is **Chrome 152.0.7977.84**; Pyodide **314.0.6** reports CPython
**3.14.2**. Page and workers report cross-origin isolation. The selected index
SHA-256 is `3fdaef09e9e365c85e002737720f8d0ab8f278c1c244a2dde6a37663cf488ad4`.
The exact installation calls, dependency resolution, licenses and native
requirements in the pinned-input sections above remain unchanged; all resolved
versions match those tables, including PyMuPDF **1.27.2.2**. Legacy `fpdf` is
absent and `fpdf.__version__` matches the `fpdf2` distribution.

| Real browser worker profile | Assertion groups | Canonical byte comparisons | Backend operations | Remaining handles |
| --- | --- | --- | --- | --- |
| MEMFS control | 11 passed | Not applicable | 0 | 0 |
| Scoped canonical bridge | 11 passed | 18 passed | 4787 | 0 |
| Canonical bridge with 1ms delay | 11 passed | 18 passed | 4787 | 0 |
| Root canonical bridge | 12 passed | 20 passed | 5857 | 0 |

All profiles pass DOCX heading/paragraph/table/image create, save, reopen and
edit; openpyxl value/date/formula/style edits with retained image/chart parts;
XlsxWriter formatted multi-sheet creation read by openpyxl; and fpdf2 three-page
generation with embedded TTF/image streams, followed by pypdf text/metadata,
split/merge and BytesIO round trips. Unicode/space paths, seek/truncate, spooled
temporary rollover, streaming workbook modes and corrupt-input recovery also
pass. PyMuPDF renders a **298×421** PNG and extracts structured text/image
blocks on every profile. The rendered page was visually inspected: accented
text and the embedded blue image are visible. The browser summary screenshot
was inspected. ReportLab evaluation is unnecessary because the required PDF
generation features pass. Formulas are stored or explicitly cached, never
recalculated by these tests.

Source bindings: `documents.py` SHA-256
`7b100a2b9a16cd475478e0184fab1f79d93475cf9c004fa0190f5a9565f87b22`;
served browser bundle
`11e3758750d94029b303d13a1e31d68b52c64b1a1d669835cd29ec16d28ebc20`;
served worker
`b53297d10fa9fd2338527b38949b26ff905c5dc9d0cda55c887d05f06984b0dc`.
No script, artifact collection or report collection errors occurred. These
bindings qualify the experimental browser fixture, not a public browser command
adapter, restrictive CSP, Cloudflare deployment or complete guest confinement.

### Public ordinary-script acceptance and reproduced gap

Separately provisioned the optional Node profile, then ran the maintained
public suite offline using built `poe-code` exports on Node **22.22.2**:

```sh
SAFE_BASH_PYTHON_CACHE="$PWD/out/pyodide-document-qualification/cache" \
  node packages/safe-bash/tests/integration/pyodide-runtime/provision-public-runtime.mjs
SAFE_BASH_PYTHON_CACHE="$PWD/out/pyodide-document-qualification/cache" \
  node --test packages/safe-bash/tests/integration/pyodide-runtime/public-documents.test.mjs
```

The unchanged baseline passed **2/2** memory/delayed public document tests.
Extended that suite to stage the browser-qualified script on canonical storage
and invoke it through actual `python qualified-documents.py` dispatch, with
`PROBE_ROOT=/work PROBE_FONT=/work/font.ttf PROBE_PROFILE=bridge`. This adds
dates, multi-sheet formatting, merge/split and embedded stream checks to public
acceptance, without runtime downloads or host writes during the test.

The extension reproduces an unresolved required workflow:
`tempfile.TemporaryDirectory` cleanup calls `shutil._rmtree_safe_fd`, whose
`os.open(..., O_RDONLY|O_NONBLOCK, dir_fd=...)` fails with **ENOTSUP (138)**.
The script records its filesystem group as failed and exits **1**; the other
ten assertion groups pass. Browser success does not qualify this production
descriptor path. The public suite retains the failing cleanup assertion as an
explicit TODO for each backend, rather than substituting weaker recursive path
deletion or counting the workflow as a pass. Named/spooled temporary-file
success does not close this directory-cleanup requirement. PyMuPDF remains
separately browser-qualified and is intentionally absent from the production
document profile.

The expanded public gate reports **2 passing backend tests, 2 failing TODO
assertions, 0 unexpected failures and 0 skips**. The delayed profile performs
9787 canonical operations before the added parent artifact reads and closes all
handles. The parent independently compares the size and SHA-256 of every
reported artifact with canonical storage. The focused real-runtime inventory
test passes **1/1**; public/browser JavaScript syntax and diff whitespace checks
pass. `npm run lint:eslint` completes with **0 errors and 2 warnings** in
unrelated existing tests. The TODOs are required
failures, not successful workflows.

Runtime setup and browser capture remain explicit integration operations,
outside fast unit discovery. Temporary captures used checkout-local `out`
because this host's `/out` is read-only; they are purged after recording these
results. No README or production implementation changes, commit, push or release
are part of this qualification. Required quota workflows, retained-directory
support, broader canonical fidelity and Cloudflare acceptance remain open.

### Independent user rerun — 2026-09-16

Executed the [independent manual QA](../../../docs/plans/pyodide-independent-user-qa.md)
against the existing working tree and rebuilt public exports. No production
code changed. Real Chrome **152.0.7977.84**, Pyodide **314.0.6**, CPython
**3.14.2** and Node **22.22.2** reproduce the qualification above: all four
browser profiles pass, including PyMuPDF **1.27.2.2** rendering/extraction.
Resolved versions, index digest and document/bundle/worker source hashes match
the preceding qualification. The exact native loading and dependency-resolving
micropip installation calls, licenses and native requirements remain those in
the pinned-input sections. Legacy `fpdf` remains absent.

Fresh commands, after successful `npm run build`:

```sh
node packages/safe-bash/tests/integration/pyodide-runtime/browser-documents/server.mjs ../../../../../../../out/pyodide-edge-rerun/browser
SAFE_BASH_PYTHON_CACHE="$PWD/out/pyodide-edge-rerun/cache" \
  node packages/safe-bash/tests/integration/pyodide-runtime/provision-public-runtime.mjs
SAFE_BASH_PYTHON_CACHE="$PWD/out/pyodide-edge-rerun/cache" \
  node --test --test-concurrency=1 \
  packages/safe-bash/tests/integration/pyodide-runtime/public-documents.test.mjs \
  packages/safe-bash/tests/integration/pyodide-runtime/public-lifecycle.test.mjs
SAFE_BASH_NATIVE_PYTHON=/Users/kjopek/.local/share/uv/python/cpython-3.14.2-macos-aarch64-none/bin/python3.14 \
  node --test --test-concurrency=1 \
  packages/safe-bash/tests/integration/pyodide-runtime/public-command-parity.test.mjs
```

| Fresh verification | Measured result |
| --- | --- |
| Browser MEMFS/scoped/delayed/root | 11/11/11/12 workflow groups pass; canonical byte comparisons 18/18/20; zero retained handles. |
| Browser DOCX/XLSX/PDF | Create/edit/reopen and artifact assertions pass, including dates, stored formulas, styles, chart/image parts, embedded TTF/image streams and PDF merge/split/text/metadata. |
| Browser edge workflows | Unicode/space paths, BytesIO, seek/truncate, boundary I/O, temporary cleanup, streaming workbook modes, invalid inputs and recovery pass. |
| Public documents and lifecycle | 18 passes, **3 failing required TODOs**, zero unexpected failures/skips/cancellations across 21 entries. Delayed document storage performs 9787 operations and retains zero handles. |
| Matched native public command parity | 56/56 pass. |
| Real product-worker and bounded stdio | 45/45 pass, including cancellation, partial I/O, broken pipes, binary bytes and worker retirement. |
| Python command units | 144/144 pass. |
| Canonical Python and retained-resize units | 121/121 pass across six files. |
| Maintained integration inventory | 109/109 pass. |
| Ordinary-script memory/delayed controls | Both pass, 166 canonical operations each. |
| Blocked backend cancellation | Retained handle closes; parent service event loop remains live. |
| Promise callback negative control | Promise is not awaited, Python receives no supplied bytes; Node 22 reports suspension unavailable. This is blocker evidence. |
| Visual checks | Browser summary, PyMuPDF-rendered page with accented text/image and built CLI initialization/42 screenshot inspected. |

The three TODOs reproduce the same two required gaps: `TemporaryDirectory`
descriptor cleanup fails on memory and delayed public storage; quota-backed
reads fail with **ENOTSUP (138)** at `/quota/input`. Neither is counted as a
pass. The canonical descriptor contract lacks retained directory operations;
the quota wrapper explicitly refuses general descriptor acquisition. Supporting
these needs retained directory/relative-operation semantics and quota-aware
retained byte writes, respectively. Path-based cleanup or bypassing quota does
not qualify either requirement. Offline misses, corrupt wheels/cache integrity
diagnostics, setup/install cancellation, output exhaustion, invocation isolation
and subsequent reuse pass without additional production changes.

Scratch screenshots, reports and provisioned cache are purged after inspection;
owned Chrome/server processes are stopped. No unit test downloads runtimes or
writes host fixtures. This is scoped QA, not all-edge-case certification, full
backend/deployment fidelity, Cloudflare support, formula recalculation or office
conversion. Required gates remain open; no commit, push or release is performed.
