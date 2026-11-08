# Here-document compatibility evidence

The shell accepts `<<` and `<<-`. The lexer queues delimiters in lexical order
and consumes their bodies at an unescaped grammatical newline, not at a
semicolon or a newline inside quotes. Delimiters undergo quote removal only;
quoted, mixed-quoted, escaped, and backtick-quoted delimiters disable body
expansion. Expansion-shaped delimiters are literal rather than executable.
ANSI-C `$'...'` and localized `$"..."` quoting remain unsupported and fail
closed in delimiters; ANSI-C ordinary words are supported separately. They are not misread as
literal dollar-prefixed delimiters. Quoted raw bodies may contain them as text.

Executed unquoted bodies are parsed as scalar parameter/arithmetic/command expansions,
with no field splitting, globbing, or tilde expansion. Quotes in body text are
literal; backslashes quote dollar, backtick, and backslash. Backslash-newline
joining precedes delimiter comparison and `<<-` tab stripping. Quoted bodies
are literal. The lexer collects raw body data without parsing its expansions.
Only executed redirections parse/evaluate those expansions, in order; skipped
branches and unused functions never reject malformed expansion data. Ordinary
command substitutions and here-string arguments still undergo complete-unit
validation before that unit's effects. Each executed redirection creates a fresh `ShellInput`; copies
of its descriptor share its cursor through existing descriptor machinery.

EOF ends an otherwise syntactically complete document. An incomplete physical
body line receives a newline, and the parser emits an EOF warning (including
for skipped documents). Diagnostics use shell offsets rather than Bash's
source/line labels. A command substitution must collect its pending documents
before its closing parenthesis; a missing grammatical newline fails closed.
The implementation does not reproduce Bash 3.2's nested-heredoc punctuation
parser bugs. Parameter/arithmetic expansion errors in a document fail that
redirection; normal word-expansion fatal scope remains unchanged.

These are UTF-8 **string** constructs, not arbitrary binary literals. Source
and environment NUL are rejected. Command substitution decodes with
`TextDecoder`, replaces invalid UTF-8, removes NUL bytes before decoding, and strips trailing LF;
document input is re-encoded as UTF-8. Literal non-ASCII text is preserved,
but non-UTF-8 substitution output is not byte-preserving. Ordinary command
streams still use `Uint8Array` unchanged.
GNU 5.3 ignored-NUL diagnostics are now emitted once per substitution. Original
Bash 3.2 warning-free raw references are retained. Invalid UTF-8 replacement is
an existing, explicit string-model boundary, not byte-preserving Bash parity.

The existing limits apply without new public API: `maxSourceBytes` bounds the
whole source, `maxExpansionBytes` and `maxExpansionFields` bound individual
scalar expansions, and command/substitution/loop/output limits share the
execution budget. The syntax nesting bound remains 64, checked when an unquoted
document is expanded rather than while raw data is collected. Document inputs are
bounded in-memory values, not temporary files. Cancellation observes the
shared signal; it cannot undo effects or forcibly terminate an uncooperative
host operation or interrupt synchronous parsing.

`heredoc.test.ts` contains isolated Bash/virtual differential tests plus explicit
grammar, cancellation, quota, UTF-8, EOF, and error-scope regressions. Both
engines use the unchanged stress process helper: isolated fresh reference
directories, sanitized environment with no `BASH_ENV`, `--noprofile --norc`,
five-second deadlines, one-MiB combined output caps, and process-group cleanup.
Finite direct virtual probes additionally use bounded source/limits or an
explicit cancellation signal.

Reference observed on 2026-08-26: `/bin/bash`, GNU Bash
`3.2.57(1)-release (arm64-apple-darwin25)`. The nested punctuation test records
its incorrect Bash 3.2 result but asserts the literal-body grammar. Bash 3.2
also omits EOF warnings, and its `$*` in a document with custom IFS has a
historical space-joining discrepancy; the implementation uses scalar
double-quoted parameter expansion instead of that historical quirk.
Its missing-parameter document error returns 127 rather than this shell's 1;
both fail the redirection, preserve prior stderr routing, and allow subsequent
commands. Error text/source labels are not byte-identical.

Primary semantic references consulted:

- GNU Bash manual, Redirections, §§3.6.6–3.6.7:
  https://www.gnu.org/s/bash/manual/html_node/Redirections.html
- GNU Bash `make_cmd.c`, `make_here_document`: queued body reading, quote
  removal, continuation/tab ordering, and EOF warning behavior.
- GNU bug-bash discussion of `$*`/IFS in documents (2024-02):
  https://lists.gnu.org/archive/html/bug-bash/2024-02/msg00124.html

No dependencies were added. Public `Shell` options and methods are unchanged;
the exported parser's AST gains optional document metadata and parse warnings.

## Here-strings and inline-input scope

`<<<` expands its target as one scalar, including tilde expansion, without
field splitting or pathname expansion, and appends exactly one LF even for
an empty scalar. That LF counts against `maxExpansionBytes`. Quoted `$*` uses
the first IFS character; `$@` and unquoted `$*` use space-separated positional
values in this scalar context. Empty arguments are retained. This context is
propagated through parameter alternatives without changing ordinary word
expansion. Here-strings use the same descriptor ownership, shared cursors,
left-to-right routing, cancellation, and command/output budgets as documents.

Input expansion for an external-style registered command runs in an isolated
variable state, while builtins, shell functions, and commandless redirections
retain shell state. Earlier redirect expansions remain visible to later ones
within the same command. This applies to commands containing inline-input
redirections; general external-process emulation for other redirections is
outside this change. Builtin classification covers implemented shell builtins
and the registry's Bash builtin equivalents `echo`, `printf`, `test`, and `[`,
using the command name before middleware dispatch.

Prefix assignments are evaluated once using the prior input before inline
redirections. External commands, builtins, and commandless redirections see
those bindings during input expansion. A function's caller-side direct
parameter expansions see the outer bindings, while command substitutions see
its temporary exported prefix bindings; redirects attached to the function
body run with the active function bindings. Temporary bindings are restored
on completion or redirection failure. Separate regression cases cover these
distinctions and preserve the existing ordinary assignment/expansion behavior.

`here-string.test.ts` and `inline-input-scope.test.ts` add scalar, descriptor,
substitution, mixed heredoc/here-string, and variable-scope coverage. Unquoted
whitespace preservation has explicit modern expectations: Bash 3.2 incorrectly
splits here-strings, a bug the GNU maintainer records as fixed in Bash 4.4:
https://lists.gnu.org/archive/html/bug-bash/2017-11/msg00105.html

The heredoc feature commit was preceded by 268/268 shell test passes. The
here-string tests initially failed 42/47, and the independent shared-state
regressions failed 4/14 before their implementation fixes. No pre-existing
test expectations, skips, or TODOs were relaxed: the one formerly unsupported
heredoc example in `core.test.ts` was replaced with a missing-delimiter syntax
error, retaining its parse-before-effects assertion.

## Final scoped validation, 2026-08-26

Environment: Node `v22.22.2`, installed Bash `3.2.57(1)-release`, Darwin arm64.

- `node --unhandled-rejections=strict --import tsx --test 'tests/shell/*.test.ts'`:
  **353/353 pass**, no failures, cancellations, skips, or TODOs.
- Unchanged `tests/shell-stress/*.test.ts`, strict rejection handling and
  `--test-concurrency=1`: **95/105 pass**, ten failures, no skipped cases.
- Twenty strict lifecycle/feature repetitions: **380/380 pass** (19 per run),
  including hard child deadlines, timer cancellation, broken-pipe cleanup,
  quotas, UTF-8 boundaries, and EOF behavior. The selection covers lifecycle
  tests plus targeted tests from the heredoc, here-string, and inline-limit
  files; it does not replace the full shell/stress runs.
- Complete unchanged `tests/shell/oracle.ts --strict`: **81/88 pass**,
  comprising **57/64 core** and **24/24 advanced-pending**; exit 1.
- Strict scoped TypeScript check of `src/shell/*.ts tests/shell/*.ts`: exit 0.
  Build-config `--noEmit`, `npm run build`, and a built ESM heredoc/here-string
  smoke test: all exit 0.
- Latest global `npm run typecheck`: exit 2 solely at the concurrently authored
  `tests/commands/bytes-stress/compression.test.ts:139`, TS2379, passing an
  optional `signal` as an explicitly possibly-undefined property. This file is
  outside shell ownership and was not edited here. An earlier global run
  passed; neither that nor scoped success replaces this latest global result.

The ten unchanged stress failures classify as six unsupported features
(descriptor moves, `read -n`, `read -d`, `$(<file)`, ANSI-C words, and POSIX
bracket classes in pathname globs), one intentional whole-source prevalidation
difference, and three diagnostic/status differences around fatal expansions.
All inline-input stress cases pass. One earlier stress run also caught a
concurrent non-shell source change; the final complete run has no such race.
The seven oracle failures are `awk`/`sed` command-registration gaps in
`createStandardCommands`, not inline-input parsing failures. No assertions,
tiers, or failure denominators were changed.

The existing broader 109-case comparator harness was **not run, installed,
edited, or reconfigured**; it is reserved for the independent final verifier.
The root coordinator must resolve the external typing/integration work and
retain the listed shell gaps in the project ledger. No full-shell or
superiority claim follows from this scoped work.

Source SHA-256 fingerprints for the validated shell implementation:

```text
aec0160b3d92755b22be0f95c3e6b0e5c6a41545a7fbb3d0c6cbe07e3b2714f5  src/shell/parser.ts
7369c84ca75e838905c2dab3b09c2f4be30a75359d9d85223f878fe34bce66a3  src/shell/runtime.ts
8e6e2165752577f29eed01dc99d4e5154a6c616c17bb712fa5a2da0ea3747e4d  src/shell/shell.ts
```
