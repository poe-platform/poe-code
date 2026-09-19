# CLI parser implementation and measured scope

The shared argparse implementation lives in `packages/csvkit/src/cli/parser.ts`.
The public SDK continues to export `parseArguments` through its root index;
the engine and the fourteen opt-in safe-bash executables use this implementation.
No new executable, wrapper, subcommand or ambient capability was added.

The reference remains csvkit 2.2.0, source archive SHA-256
`147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`.
Recorded command descriptors and help are from the CPython 3.14.2 profile in
reference-profile.json: Agate 1.14.2, SQLAlchemy 2.0.54, C locale, UTC,
UTF-8, 80 columns. The existing CPython 3.9.6 captures are preserved and are
not a selectable product profile. The frozen runtime dependency installation
was unavailable during this update; native checks used the authenticated
CPython 3.14.2 argparse/int implementations. The archive and dependency hashes
were not reacquired in this update.

Original failing regressions reproduced five parser mismatches before fixes:
the 4,300-digit integer conversion limit, negative-number prefix classification
(`-1e3`, `-1x`, Unicode decimal prefixes), unknown option-looking tokens containing
ASCII spaces, equals separators/empty values inside short clusters, and choice
diagnostic formatting. CPython 3.14 quotes the rejected value after converting
it to text, and prints allowed choices without quotes. The independent agent
validated token/cluster behavior and choice formatting against CPython 3.14.2.
Its 3.9 ambiguity pre-scan hypothesis was rejected after measuring 3.14 action
ordering; no fix based on that different profile was applied.

The new canonical reference suite checks all 56 recorded help, short/long
version and unknown-option observations with exact stdout/stderr/status.
It checks all command actions, defaults and usage against the recorded parser
contract, accounting explicitly for Python type names and the capture's injected
PYTHONIOENCODING=utf-8. The same 56 observations also run through actual Shell
registration. These checks cover help usage/metavars/descriptions/epilogs/order
and wrapping for the recorded terminal profile; they do not measure arbitrary
terminal widths or unrecorded locales.

The engine previously omitted the parser's match-file opener. A failing engine
regression reproduced that omission. `CsvkitContext.openMatchFile` and the
corresponding safe-bash option now explicitly inject text-handle opening with
the original path, invocation cwd and cancellation signal. The host must resolve
the virtual path and bind `-` to borrowed stdin appropriately, including close
ownership. Parsing does not read lines or infer encoding from `-e`; upstream
FileType uses its own text-opening profile. Cleanup is registered before opening,
owns pending acquisitions, closes on help/errors and transfers handles to the
parsed invocation on success. Repeated stored handles remain cleanup-owned.

Missing opening capability returns an explicit unsupported/unqualified status78
diagnostic from the engine, rather than an internal error. This is a deliberate
blocker, not a csvkit reference pass. Missing files from an injected opener are
ordinary argparse status2 errors and precede later help. Leading help/version
does not require an opener. Match-file command execution and SDK `run` match-file
binding remain blocked; eager parsing alone does not qualify either operation.

An additional reconstructed argparse grammar cohort compared 5,802 initial
cases and found 24 string-choice diagnostic mismatches. After the choice fix and
an extension for invalid numeric choices, all 5,898 cases match. This is a native
argparse comparison using recorded actions, supplied captured help and usage;
it excludes FileType vectors and actual csvkit application execution. It does
not qualify help generation or any CSV operation. The initial failure cohort,
matrix definition, input hashes and harness correction are preserved in
[parser-grammar-reference-20260918.json](parser-grammar-reference-20260918.json).

Current fast in-memory domain units pass291/291; focused actual Shell tests
pass57/57, including independently authored opener/timing/cleanup/refusal/choice cases.
The selected csvkit build, domain ESLint and source/test TypeScript checks passed.
The maintained safe-bash build closure also passed. Actual compiled Shell help
and errors were rendered using terminal-png and visually inspected: alignment
and wrapping were readable, with no clipped content. Owned temporary screenshots
and capture scripts are removed after reducing their findings into this record.
The maintained safe-bash source/test and public-consumer typecheck route passed,
including all 26 declared current consumer groups and required negative controls.
These are typechecks, not runtime or service qualification.
Guarded repository ESLint completed with zero errors and the two existing docx
test warnings. Final domain lint/typechecks cover the choice-formatting fix;
the independent agent's final Shell suite includes its subsequent exact choice
diagnostic regression. The repository lint invocation overlapped that final
focused work and is not a sealed final-candidate qualification.

One attempted safe-bash npm test invocation with literal file operands expanded
to the entire maintained inventory. It was stopped; it is not credited as a full
test pass. Focused checks used the literal node:test paths instead. No full
repository unit pass is claimed.

The wider suite remains unfinished as recorded in implementation-status.md.
In particular, csvformat accepts only its original flags and `-U 2` parses, but
typed QUOTE_NONNUMERIC number inference/output remains an explicit operation
blocker. No unimplemented Agate, regex, format, database, interactive or service
path is credited by these parser checks. No README content, staging, commits,
pushes or publications were added.
