# Diagnostic edge validation, September 18, 2026

Procedure: [diagnostic edge QA](../plans/csvkit-diagnostic-edge-qa.md).
This is a bounded follow-up to the diagnostics implementation, not complete
csvkit compatibility or exhaustive edge-case qualification.

Three domain regressions were reproduced before fixes:

- Unknown filesystem codes matching inherited object keys (`constructor`,
  `toString`, `__proto__`) produced a bogus Python exception instead of retaining
  the opaque adapter failure. Errno lookup now requires an own property. Tests
  check both direct translation and invocation failure identity/empty channels.
- Source lines used JavaScript trim rather than Python strip. Frozen CPython
  removes U+0085 and preserves U+FEFF. Warning and explicit-frame formatting now
  use the existing Python whitespace profile.
- Empty source text added an unwanted indented newline. Python warnings omit
  an empty supplied source but retain a newline for nonempty whitespace-only
  source; Python traceback frames omit stripped-empty source. Each formatter now
  follows its independently measured rule.

Reference-only research authenticated CPython 3.14.2 at
`/Users/kjopek/.local/share/uv/python/cpython-3.14.2-macos-aarch64-none/bin/python3.14`:
SHA-256 `3d6400b63b150164e89a690d9813af8b0eb420af9f336ef1f6c5102c6da60eae`.
Isolated `warnings.WarningMessage`/`warnings._formatwarnmsg` and
`traceback.FrameSummary`/`StackSummary` observations supplied expected strings.
These measure Python formatting primitives, not actual csvkit warning emission,
filters, complete traceback identity or driver compatibility.

An independent stress agent reproduced preclosed stdout changing a stderr-only
argparse error into status 141 with empty stderr. The safe-bash adapter now
defers stdout enrollment until output or stdin acquisition and retains the
caller signal separately. Cooperative cleanup is memoized, registered with the
invocation and enrolled output, and awaited on completion. New actual-shell
regressions pin parser status 2, delayed file error status 1 and pending-input
consumer closure, including iterator return exactly once and unchanged caller
signal. Existing output backpressure, cancellation, pipeline and cleanup tests
remain in the executed cohort.

Current checks:

- Maintained domain unit suite: 307/307 passed, no skipped cases.
- Maintained domain lint: ESLint, product/test TypeScript checks passed.
- Selected maintained domain and safe-bash build closures passed; safe-bash
  selection derived ten build tasks and ran native postbuild stages.
- Both actual-shell csvkit files: 68/68 passed, no skips/cancellations.
- Maintained safe-bash typecheck passed source/tests and 26 current consumer
  groups, including expected exit-2 negative controls. No runtime service
  acceptance is inferred from declaration checks.
- Guarded repository ESLint completed with exit 0, zero errors and two warnings
  in docx tests outside this increment.
- Compiled public SDK formatter and compiled public Shell/plugin were rendered
  with the repository terminal PNG renderer and inspected. Explicit traceback,
  warning text and preclosed-stdout parser/file errors were readable and not
  clipped. Those images are disposable evidence, not screenshot tests or native
  warning/traceback qualification.

Exact traceback identity/chaining/caret details, warning source/filter/emission
parity, unsupported formats and typed operations, real services and previously
recorded full-repository delivery gates remain blockers. No full repository
unit-suite pass is claimed. No README additions, staging, commit, push or release
actions were performed.
