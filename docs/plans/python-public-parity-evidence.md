# Public Pyodide command differential evidence

Follow-up: the [subsequent user review](python-public-followup-review.md) fixes
the four command TODOs recorded below and adds twelve alias cases. This document
preserves the original failing observations and earlier run counts.

Date: 2026-09-13. Scope: the maintained
`packages/safe-bash/tests/integration/pyodide-runtime/public-command-parity.test.mjs`
suite. This is a selected command comparison, not full Python or Bash compliance.
Document workflows, filesystem compositions, runtime recovery and rendering have
separate integration and manual QA evidence.

## Provisioning and execution

The suite imports only built public `poe-code/safe-bash`, its Python command and
Node worker exports, and canonical `poe-code/safe-fs/core`. It never imports product
TypeScript or implements its own worker/bridge. Runtime installation and native
Python installation happen before the opt-in suite; the suite does not download
runtime assets. Native oracle files are temporary integration fixtures removed
at teardown. They are outside the fast unit-test route.

The pinned Pyodide package is 314.0.6 and embeds CPython 3.14.2. Exact patch-version
matching is an assertion: missing native configuration or a mismatch fails instead
of silently skipping or using the available system Python 3.14.7.

Provisioned the native oracle with:

```sh
uvx --from uv@latest uv python install 3.14.2
```

The existing system `uv` and uv 0.8.22 lacked a matching download manifest; the
current isolated uv provision succeeded. The executable used was:
`/Users/kjopek/.local/share/uv/python/cpython-3.14.2-macos-aarch64-none/bin/python3.14`.
The test environment was Node v22.23.2 and GNU Bash 3.2.57(1)-release
(arm64-apple-darwin25). Shell environment is supplied explicitly. Native Bash
resolves both Python aliases through fixture symlinks to that exact executable.

```sh
SAFE_BASH_NATIVE_PYTHON=/Users/kjopek/.local/share/uv/python/cpython-3.14.2-macos-aarch64-none/bin/python3.14 \
  node --test packages/safe-bash/tests/integration/pyodide-runtime/public-command-parity.test.mjs
```

`SAFE_BASH_PYODIDE_RUNTIME_URL` optionally supplies an explicitly provisioned
runtime module; otherwise the suite uses the isolated integration package's
installed Pyodide. No environment variable authorizes an implicit download.

The native temporary directory is resolved with `realpath` before constructing
the memory filesystem at the same absolute path. This handles macOS `/var` to
`/private/var` fixture aliases. No normalization is applied to command output,
argument metadata, tracebacks or file contents.

## Compared observations

Each alias has 21 command cases: file, `-c`, `-m`, explicit stdin, implicit stdin,
arguments including empty/spaced/Unicode strings, main-module metadata, local and
relative package imports, cwd/environment, uncaught exceptions, syntax errors,
stdout/stderr, numeric/negative/wrapped/string exit statuses, shell status,
heredocs, binary stdin/stdout/stderr, binary pipelines, input/output/stderr
redirects, random-access files, and executable env shebangs. Every comparison
asserts exact status, stdout bytes and stderr bytes. Designated output files are
also byte-compared against native oracle effects.

A separate test mutates modules, builtins, environment, cwd and import paths,
then verifies a new invocation sees clean interpreter state and newly edited
canonical module contents. Direct canonical writes are read by Python, Python
writes are read through canonical storage and `cat`.

## Unresolved required parity

The strict measured run failed: 44 node:test entries, 39 passing, five failures
(four leaf failures plus their containing parent). Four exact failing assertions
are retained as explicit TODOs, not weakened comparisons or passing cases:

1. Both aliases omit the source line in an uncaught `-c` exception traceback.
   For `raise ValueError("guest failure")`, native stderr is 138 bytes and
   includes `    raise ValueError("guest failure")`; safe-bash stderr is 100
   bytes and omits that line. Syntax-error stderr matched exactly.
2. Both env shebang cases execute successfully, but `./script` main-module
   metadata differs: native `__file__` retains the `/./script` spelling and
   safe-bash normalizes it to `/script`. The two-byte difference is retained
   in the assertion. This is an unresolved compatibility gap, not declared
   an intentional platform difference.

An exit-zero suite with these TODOs is not full compliance. TODO comparisons
still execute and expose their exact byte differences. They must be resolved
and their TODO markers removed before these workflows count as passing.

## Intentional platform differences and limits

Pyodide is an Emscripten wasm32 interpreter, while this oracle is native macOS
arm64. The suite checks the guest platform and four-byte pointer width and emits
both interpreter identities including `sys.executable`. It does not normalize
these properties into a parity claim. A configured trusted Node worker is used;
these tests do not establish a hostile-code sandbox.

Coverage does not establish arbitrary native extensions, process creation,
signals, subprocesses, threads, terminal/interactive behavior, every Python flag,
complete diagnostic parity, symlink semantics, every encoding, or all possible
pipeline races. File and module error modes outside the maintained cases remain
unmeasured by this suite. Other acceptance tests are additional evidence and do
not turn this selected matrix into full compliance.

## Measured maintained outcome

The subsequent complete suite ran in 66.95 seconds and exited zero with 44
node:test entries: 40 passing, four TODO, zero failures, zero skips and zero
cancellations. Among the 42 alias cases, 38 passed and four remain TODO; the
other two passing entries are the containing command test and the separate
isolation test. This count must not be described as 44 passing workflows.

The runtime identity emitted was `["314.0.6", "emscripten", 4, ""]`; the native
identity was `darwin`, eight-byte pointers and the explicitly configured Python
executable through the temporary alias. These intentional platform differences
are independent of the four unresolved diagnostic/metadata TODOs.

Local raw evidence is preserved under
`output/python-public-integration-20260913/parity-strict-failures.log` and
`output/python-public-integration-20260913/parity-todo-evidence.log`.
