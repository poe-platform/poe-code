# csvpy: scoped JavaScript Python console

## Source contract

Executable source: csvkit 2.2.0 `csvkit/utilities/csvpy.py`, archive SHA-256 `147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`. The existing frozen reference profiles in `docs/csvkit/reference-profile.json` remain unchanged. Agate source inspected is the pinned 1.14.2 distribution.

The original descriptor exposes `FILE`, the reader/type-inference shared arguments, `-v/-V/-h`, and only five local argument declarations (`--dict`, `--agate`, `--no-number-ellipsis`, `-y/--snifflimit`, `-I/--no-inference`). `override_flags` removes line numbering, zero-based selectors and BOM output. No selectors, writer options, names option or replacement csvkit subcommands are introduced. There are no local/shared option-string collisions. `-y/-I` have table-only loading effects; they do not sniff or infer a plain reader. `--dict` takes priority over `--agate`. `-H` reaches the reader `header` keyword; the Agate DictReader subclass inherits CPython's unsupported-keyword rejection.

## Maintained engine and injection

The executable implementation is in `packages/csvkit/src/commands/csvpy.ts`; both SDK and registered safe-bash commands dispatch through it. Existing explicitly injected interpreter providers remain supported. The additional `loadConverted` path delegates CSV parsing/inference to JavaScript and constructs real session-owned Python values through `createCsvpyInterpreter`. The host explicitly supplies a legitimate PythonSession constructor, interpreter limits/hash seed and a cooperative terminal `readLine(signal)` service. Outputs use the actual engine's stdout/stderr sinks with awaited writes and engine output budgets. Synchronous guest output is bounded and buffered until an interactive input finishes; the interpreter cannot await sink backpressure during guest execution itself. No product native subprocess, installed Python csvkit, host filesystem, ambient terminal or IPython fallback is used.

PythonSession container, callable and session-local module registration APIs are documented separately in `csvpy-python-bridge.md`. A scoped guest library supplies reader iteration and DictReader fieldnames/restkey/restval; a scoped `agate.config` module reflects number-ellipsis configuration without changing other sessions. CSV parsing happens on guest iteration, including iteration inside guest loops. Reader headers remain unconsumed until iteration; DictReader lazily consumes the first record as fieldnames. Field limit failures are translated into guest reader exceptions. Buffered guest output is admitted against the engine retained-byte budget before it is stored, then drained before subsequent exception diagnostics. Resource acquisition is enrolled before loading and guest close is idempotent; signal reasons, including false, survive cleanup. Retirement closes read admission, aborts the session-local signal and drains admitted cooperative terminal reads before closing the guest. Terminal input is borrowed and never closed.

## Recorded profiles and blockers

`safe-python-scoped-console-v1` is an implemented scoped profile. It is **not** a qualified exact `code.interact` or IPython profile. Expression display, semicolons, bracket/suite collection, output, EOF, SystemExit and simple exception formatting have canonical in-memory regression coverage. There is no differential native interactive capture in this change.

Remaining blockers, never counted as passes:

- Transport/decoding is buffered by `runtime.text` before opening a reader console. CSV parsing is lazy, but file/encoding error timing and streaming memory behavior do not match a live CPython file iterator. Without an injected filename-open probe, opening is established by loading rather than a separate filename-access operation.
- Scoped Reader/DictReader classes do not provide the entire Agate/CPython CSV object, dialect, mutation or stdlib surface. Import aliases and module identity have selected tests, not a complete compatibility audit.
- JavaScript table loading/inference is implemented, but a complete guest Agate Table/Row/Column/MappedSequence and Decimal/temporal object library remains unimplemented. The scoped adapter refuses table mode with status 78 unless the host explicitly injects a qualified `createTable` object-library capability. It never constructs a tuple-backed substitute and reports it as an Agate Table. Legacy injected interpreter providers retain their explicitly declared modes.
- Arbitrary multiline console compilation, exact syntax-error formatting, KeyboardInterrupt recovery and complete traceback frame retention are unqualified. The collector now uses maintained parser-backed single-input compilation, including brackets, triple strings, continuations, suites and semicolon display. Exact `codeop` future state, diagnostic arbitration and configurable `sys.displayhook` remain separate interpreter qualification gaps.
- Nested `input()` cannot use asynchronous terminal input through the synchronous interpreter services. Full Python stdlib is not granted implicitly.
- Optional IPython requires its own explicit library/profile qualification. It is not auto-loaded, substituted or reported as supported.
- Terminal input must cooperate with the supplied signal; cleanup cannot preempt opaque host services. Synchronous host callbacks are trusted and bounded by explicit guest/invocation budgets, not a host-code sandbox.

## Validation

Original regressions demonstrated reader field errors occurring before the REPL, interpreter capability checking before filename access, missing module identity, non-exiting SystemExit and missing config imports. An independent agent exercised actual registered-shell argv rejection, header/skip-lines semantics, dict precedence and mutable properties, unread-field laziness, cancellation and exactly-once guest cleanup. Narrow maintained build/lint and broader root gates are recorded only according to their actual outcomes; failures and timeouts do not establish compatibility.

## User edge review

Console exception handling now uses a private guest namespace, preserving user globals (including `_csvpy_error`) and remaining usable when the user shadows `str`, `type` or `isinstance`. Guest exception messages are evaluated once. Nested unfinished suites now retain incomplete-input status at synthetic EOF dedents; a real following dedented statement remains a syntax diagnostic. The earlier DictReader review asserted initial-skipped-row line counters for successful rows; the native correction below supersedes that assertion. The review's historical checks and remaining gate limits are recorded in `docs/csvkit/csvpy-user-edge-validation.md`.

The public-object differential review establishes that `fieldnames` always synchronizes `line_num`, including when the header already exists. A successfully returned row after blanks therefore reports that row's physical line. Blank-only exhaustion retains the initial skipped-row counter until `fieldnames` is read again. See the frozen transcripts, full namespace census and explicit library blockers in `csvpy-public-object-contract.md`. The historical review record remains preserved.
