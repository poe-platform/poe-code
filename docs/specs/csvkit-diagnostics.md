# csvkit diagnostics contract

Authority: released csvkit 2.2.0, archive SHA-256
`147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`,
under the existing [frozen reference profile](../csvkit/reference-profile.json).
The handler source is captured in source-flow-audit-20260917.json at
`def handler(t, value, traceback)`. This document does not qualify the entire
command suite.

The original executable parser owns status 2, usage and argument-error output.
Help and version exit with status 0. Eager argparse FileType match-file opens
occur while actions execute, including before a later help action. Ordinary
CSV input reads are delayed until the operation runs. A missing positional file
therefore cannot override help. csvclean writes its validation report directly
and returns status 1; it does not use the uncaught exception handler.

`PythonException` carries the Python class and message for injected application
services. Nonverbose output is `class: message` followed by one newline, even
if the message already ends with a newline. UnicodeDecodeError instead uses the
reference encoding suggestion. Existing source-derived operation diagnostics
already contain their Python class names. Known POSIX filesystem errno values
map at the input-read boundary, using the original argv filename in the Python
message and the resolved virtual filename only for filesystem access. Cancellation
is checked before errno translation and before selecting a final status.

Verbose success runs normally. On errors, verbose output accepts an explicit
named Python traceback profile with ordered outer-to-inner frames: Python path,
positive line number, function and optional source line. It emits the Python
traceback heading, frame lines, source lines and final exception class/message.
It never emits a JavaScript stack. This is an injected reference representation,
not authentication of caller-supplied frame identity. Missing/invalid reference
metadata returns status 78 with a named traceback blocker after actual operation
execution. Parser exits and csvclean validation do not require traceback frames.

Exact verbose identity remains **BLOCKED**. CPython version, launcher installation,
site-package paths, linecache source availability, frame sequence, chained
exceptions, SyntaxError details and PEP 657 caret/range formatting can vary.
The formatter implements a basic explicit-frame contract, not all of
`sys.__excepthook__`. No deployment-specific paths or synthetic JS-to-Python
frame mapping are claimed byte-identical. Native UTF-8 decoder exception details
and built-in operation frames remain unqualified.

`warningText` formats supplied Python path/line/category/message/source provenance.
It is a formatting primitive only: automatic warning categories, per-source
emission, filter registry, repetition suppression and ordering remain **BLOCKED**
where existing operations explicitly refuse unqualified warning paths. Formatting
tests do not count those operations as warning parity. Injected database/codec
services must provide reference exceptions; an arbitrary JS Error cannot establish
a SQLAlchemy/DBAPI/Python class or traceback. Type/date/encoding/JSON/database cases
outside the existing frozen case inventories remain unmeasured blockers.

The safe-bash bridge retains output-operation enrollment and awaited writes.
Stdout enrollment is deferred until stdout is used or stdin is acquired;
preclosed stdout cannot suppress stderr-only parser or delayed-file errors.
The invocation retains its caller signal, while enrolled stdout closure closes
owned input through memoized cooperative cleanup.
An enrolled consumer EPIPE follows safe-bash's status-141 contract with no Python
diagnostic. Opaque sink failures retain their host failure semantics; no global
signal handler is installed or modified. Independent stress cases cover eager
opens, delayed reads, falsey/errno-shaped cancellation and consumer closure.
Small buffered pipeline output can complete both stages with `[0, 0]` before
consumer closure; output exceeding pipe capacity measures `[141, 0]`. Both
pipeline aggregates return 0. Buffered shell results retain attempted output
bytes when an external enrolled sink refuses a write; this is the safe-bash
result contract, not proof those bytes reached the external sink.
Literal csvgrep no-match follows the measured existing source path returning 0;
no grep-style status 1 is inferred. Regex and match-file execution remain blocked.

The new file-error assertions are source-derived CPython/POSIX expectations,
not a fresh full frozen-csvkit differential capture. Other existing reference
inventories retain their original measurement scope. Neither a passing unit
suite nor these stress cases certify complete csvkit compatibility.
