# Python command integration

## Scope and method

Implement the existing explicit Python plugin as `python` and `python3`, using a
fresh dedicated Pyodide worker for every invocation. Preserve the canonical
filesystem bridge already present in this workspace. No host Python fallback.
Do not edit README. Existing unrelated edits are outside this change.

Use failing unit tests before command/protocol changes and opt-in real Wasm
integration for actual Python semantics. Unit mocks cannot establish interpreter
compatibility. The acceptance suite uses canonical in-memory application files;
the pinned runtime assets are loaded from the existing isolated integration install.

## Required measurements

| Area | Required observations | Evidence target |
| --- | --- | --- |
| Registration | explicit plugin aliases, collision preflight, lazy runtime creation | command unit tests |
| Entry modes | file, inline, module/package, explicit/implicit stdin, directory, ZIP | command acceptance + launcher integration |
| Python metadata | importable `__main__` identity, file/package/spec, argv and path per mode | command acceptance |
| Parsing | option termination, attached/separate values, flags after source retained | invocation unit + launcher integration |
| Flags | native CPython startup behavior for supported options, explicit refusal for remaining options | invocation unit + launcher integration |
| Source decoding | raw bytes and encoding declarations in files and stdin | command acceptance |
| Canonical storage | local imports, relative/absolute cwd, symlinks, directory/ZIP main, readonly/mount behavior | product-worker + acceptance |
| Shebangs | existing script resolution dispatch with untouched source bytes | shell unit + real launcher |
| I/O | input data vs source, `input()`, EOF, buffer bytes, flush, closed streams, pipe failures | acceptance + product-worker + stdio |
| Status | None/int/string SystemExit, syntax/runtime failures, absent files/modules, shell status | acceptance |
| Isolation | fresh worker, imported module/global/env/cwd mutation, updated canonical imports | acceptance + command unit |
| Lifecycle | cancellation and pending I/O retirement, descriptor closure, initialization errors | command unit + product-worker |
| SDK/CLI | shared options, explicit runtime selection, progress and shell result propagation | SDK/CLI unit + manual screenshot |
| Terminal | no-argument interactive Python, `-i`, tty detection, prompts/editing/signals | explicit gap below |

## Terminal inventory

`contracts/command.ts` provides byte stdin/stdout/stderr, input provenance and
cancellation. `shell/types.ts` provides no TTY identity, terminal session,
window size, interactive line editor, or terminal signal contract.
`stdinIsDefault` describes provenance and cannot be used to infer a terminal.
Consequently no-argument Python in this shell consumes source until EOF. Guest
`isatty()` is false. Interactive no-argument use and `-i` are compatibility gaps;
refusing `-i` must not be reported as implementing interactive Python. Python
`input()` over noninteractive data streams remains a required supported operation.

## Baseline and completion evidence

The first new acceptance run reported 20 passing and 9 failing tests out of 29
reported Node tests (including parent groups). Failures reproduced missing
`__main__` identity, incorrect entrypoint metadata and encoded stdin handling.
The run overlapped implementation, so its count is a red-test observation, not a
frozen revision baseline. Final results must be captured after implementation.

Manual upstream qualification: pinned Pyodide accepts CPython startup flags in
`loadPyodide({args: [...]})` **without an executable element**. Probes verified
`-S`, `-I`, `-OO`, `-b`, `-X utf8` and `-u` load; `sys.flags` reflects startup
settings. Pyodide mutates the input argv array. Passing `-Werror` during bootstrap
raises a warning as an error before user execution and needs separate handling.

Behavior references:
- https://docs.python.org/3.14/using/cmdline.html
- https://docs.python.org/3.14/library/runpy.html
- https://pyodide.org/en/stable/usage/streams.html

No full CPython compatibility, browser deployment, commit, push or release is
established by these focused tests. Add final measured results and remaining
specific gaps here before delivery.

## Remaining compatibility boundaries

- Interactive terminal modes remain unsupported because the shell has no terminal
  contract. No-argument source input is not a REPL.
- Pyodide has runtime-specific defaults, including disabled bytecode-cache writes
  by default and a relocated standard-library namespace. This is not a drop-in
  host CPython installation with identical startup/site configuration. Native
  flags are tested separately from these runtime defaults.
- `PYTHONHOME` cannot replace the qualified runtime; `PYTHONINSPECT` cannot enable
  an absent terminal mode. Both are explicit configuration failures unless
  `-E`/`-I` ignore them. Canonical `PYTHONPATH` is applied after runtime bootstrap;
  canonical startup `.pth`/site-customization parity has not been established.
- Warning filters are intentionally applied after Pyodide bootstrap, so warnings
  from runtime initialization are outside the guest warning-filter contract.
- Browser worker mounting was qualified in the prior experiments; the new Node
  CLI/launcher changes do not establish a fresh browser deployment qualification.
- Filesystem descriptor and native-extension limitations from the existing Python
  filesystem contract remain. Tested canonical operations do not certify every
  backend syscall or third-party Python package.

A later acceptance run was invalidated during screenshot preparation because a
concurrent maintained build temporarily removed the imported
`packages/safe-js/dist/safe-fs-core.js` bundle. Those `ERR_MODULE_NOT_FOUND` cases
are retained as invalid-run evidence, not counted as Python semantic failures or
passes. Final execution checks run after bundle publication has completed.

The final launcher also normalizes `SystemExit` in Python before converting its
status to JavaScript. Overflow follows the pinned interpreter's native C-long
width (Wasm32), then the shell receives the low byte. Very large integer exits
can therefore differ from a host with a 64-bit C long; this is an explicit
platform boundary. Uncaught `KeyboardInterrupt` returns status 130.

Broad lint initially found undeclared browser globals in the existing browser
qualification fixtures. Only environment annotations were added; the
`parentPort` adapter is explicitly marked as used by the server-injected bridge.
The browser fixture behavior and historical captures are unchanged. This lint
repair does not constitute a renewed browser runtime qualification.

Two additional delivery regressions were reproduced and fixed:

- Root bundling moved the Node adapter into `dist`, breaking its relative worker
  URL. It now resolves the worker through the public package export. The actual
  bundled SDK is covered by an opt-in regression, separately from source imports.
- A downstream shell consumer closing its pipe originally forced status 141
  before Python could handle `EPIPE`. Python now uses the existing destination
  output-operation API, preserving `BrokenPipeError`, stderr and Python's status.
  The actual one-byte shell pipe regression and external-sink flush cases pass.
  Small writes that finish before reader closure can legitimately succeed; the
  regression uses repeated writes to ensure it observes a closed pipe.

## Delivery measurements (2026-09-13)

- Final maintained `npm run build`: passed, including the root SDK/CLI bundles.
- Repository `npm run lint`: passed with zero errors and 12 warnings in unrelated
  cached presentation examples. Final subsequent source/test edits also passed
  scoped ESLint. `npm run lint:types` passed.
- Final Python command/plugin/shebang, readonly and descriptor-observer tests:
  178 passed, zero skipped. SDK/CLI/package-export checks: 29 passed.
- Final shell-language suite, including the exact glob-byte boundary and
  overflow-before-effects cases: 194 passed, zero skipped.
- Final real Pyodide command-acceptance, launcher and product-worker suites:
  86 reported tests passed, zero failed or skipped (including parent groups),
  in 88 seconds. This includes the actual bundled root SDK worker resolution
  regression and internal/external broken-pipe cases.
- Built `node dist/bin.cjs bash --python-runtime <qualified-module-url> -c
  'python3 -c "print(6*7)"'`: stdout `42`, status 0.
- Manual CLI screenshots were generated and inspected:
  `screenshots/bash-help.png`, `screenshots/bash-python.png`,
  `screenshots/bash-python-interactive-gap.png`, and
  `screenshots/bash-python-pipeline.png`. These show help, visible initialization,
  interpreter output, the explicit interactive refusal, and pipeline progress.

The full `npm test` did **not** pass. Its shared Vitest stage reported 30,285
passed and two skipped tests; the safe-bash runner self-tests passed 500/500.
The subsequent safe-bash stage reported 37,967 passed, six failed and 823 skipped
tests. Three failures reproduced readonly unlink policy ordering; two others
were observer/glob test expectations that omitted redirect creation's parent
capability admission. These five failures were repaired and passed the focused
final suites above. The full suite was not rerun after those repairs.

The remaining S3 HTTP committed-archive gate refuses qualification before any
verification steps: `Peer binding requires the selected committed package
metadata`. The default selected revision is HEAD
`1b7ec7e2df185fbc449033733711ebdaa8d63f2c`; its root and safe-bash package manifests
do not match the working tree. Qualification requires a real committed revision
with matching manifests and peer artifacts. No revision was synthesized, no gate
was skipped or relaxed, and no commit or push was performed. Later workspace
test stages are not established by this stopped full run. Skipped tests are not
counted as passes.

Raw validation logs are local `/tmp/python-{build,unit,wiring,shell,runtime,cli,lint}-delivery*`
files; broad-run logs are `/tmp/python-test-final.log` and
`/tmp/python-lint-final.log`. These are local observations, not published release
qualification.
