# Python command user review

Review date: 2026-09-13. This review tests the existing working-tree integration;
it does not certify a committed revision, release, or complete CPython parity.
Existing unrelated edits are preserved. README is outside this change.

## Review scope

| Requirement | Evidence route |
| --- | --- |
| File, inline, module, explicit/implicit stdin, directory and ZIP entrypoints | Real-runtime command acceptance and launcher suites |
| Main-module metadata, local imports, encoding declarations and argv | Real-runtime command acceptance suite |
| Environment, cwd, isolation and startup flags | Acceptance, launcher and invocation suites |
| Raw bytes, input/EOF, redirects, pipes, flushing and broken pipes | Acceptance and product-worker suites |
| Cancellation, cleanup, lazy loading and progress lifecycle | Command unit and product-worker suites |
| Shebang decoding and dispatch | Shell plugin-shebang and acceptance suites |
| SDK/CLI configuration and exported entrypoints | Focused SDK/CLI/export tests and manual CLI captures |
| Interactive/TTY behavior | Contract inspection and explicit CLI refusal; unsupported |

Unit worker doubles verify the host protocol, not Python execution. Real-runtime
tests use the locally installed, pinned Pyodide 314.0.6. Native CPython probes are
comparison tools only; product execution never falls back to a host subprocess.

## Confirmed defects repaired with regression tests

- `--` did not preserve literal filenames named `-c` or `-m` during execution.
- Normal and exceptional completion skipped Python `atexit` callbacks.
- Uncaught exceptions ignored guest `sys.excepthook`.
  The review also reproduced a hook calling `sys.exit(7)` incorrectly returning
  status 1; the same SystemExit conversion now applies inside the hook.
- `PYTHONHOME`/`PYTHONINSPECT` execution restrictions incorrectly rejected help
  and version requests.
- An unclosed buffered application file lost its unwritten contents at exit.
  The worker now calls the qualified native CPython finalizer while filesystem
  and stream service remain available; callback and file shutdown use CPython.
- A closed external CLI pipe raised an unhandled Node stream error. The CLI now
  owns error listeners for the invocation, preserves write rejection for Python,
  and removes those listeners when execution settles.

## Boundaries

The shell exposes byte streams, input provenance and cancellation, but no TTY
identity, terminal session, line editing or terminal window/signal contract.
No-argument Python therefore consumes source until EOF. This does not implement
interactive Python; `-i` remains refused.

Runtime startup/site customization, native-extension/backend interoperability,
browser deployment and every CPython flag/environment combination are not fully
qualified by this review. Existing documented Wasm32 exit-integer and filesystem
capability boundaries remain. Unmeasured cases are not passes.

Explicitly rejected options include `--help-env`, `--help-xoptions`,
`--help-all`, `-x`, `-i`, and unsupported `-X` spellings such as `dev=1`.
`-V -i` is also rejected even though host CPython can print its version without
entering interactive mode. Exact host diagnostic wording/errno numbers and
exception audit-hook parity are not established.

## Validation

Initial command unit/plugin/shebang run: 71 passed, zero failed or skipped.
Post-fix command unit/plugin/shebang run: 82 passed, zero failed or skipped.
Integration-input registration checks: 108 passed, zero failed or skipped.
Focused ESLint passed for Python implementation and modified tests.
SDK/CLI/export tests: 12 passed, including stream-error listener cleanup.

Regression tests failed before each fix. A focused native-finalization run
passed eight reported tests. An intermediate whole acceptance run was
invalidated when the concurrent build removed the imported safe-js bundle
(51 reported passes and four module-loading failures). That run is not counted
as final qualification. The combined final suite runs after build publication.

The maintained full build passed (73 workspace tasks), followed by a successful
selected virtual-bash build closure and root bundle for the final exception-hook
change. Ten manual real-runtime SDK cases passed, including raw binary input,
EOF, source/data separation, errors and non-TTY stream identity.

Built CLI host-pipe checks verified an uncaught repeated write returns status 1
with Python `BrokenPipeError`, and a caught error preserves status 7. Neither
produces the former unhandled Node error. A single unbuffered raw write can
legitimately succeed with an accepted prefix; it is not evidence that the whole
requested buffer reached the reader.

Generated and visually inspected local captures (ignored by Git):

- `screenshots/python-user-review-success.png`: TTY progress and output 42.
- `screenshots/python-user-review-final.png`: execution, exit callback output
  and explicit interactive refusal.
- `screenshots/python-user-review-pipe-close.png`: Python broken-pipe traceback
  and status 1, with no Node crash.

Final combined real-runtime acceptance, launcher and product-worker suites:
99 reported tests passed (including parent groups), zero failed, skipped or
cancelled, in 112.2 seconds. The run used `--test-concurrency=1` after the final
build and is recorded in
`/tmp/python-combined-final-20260913-options-review.log`.
Other local logs: `/tmp/python-user-review-unit-final.log`,
`/tmp/python-user-review-registration.log`,
`/tmp/python-user-review-runtime-final-lint.log`.

No full repository test run, committed revision, push or release is claimed by
this focused review. No commits, pushes or README edits were made.
