# Here-document compatibility evidence

The shell accepts `<<` and `<<-`. The lexer queues delimiters in lexical order
and consumes their bodies at an unescaped grammatical newline, not at a
semicolon or a newline inside quotes. Delimiters undergo quote removal only;
quoted, mixed-quoted, escaped, and backtick-quoted delimiters disable body
expansion. Expansion-shaped delimiters are literal rather than executable.

Unquoted bodies are parsed as scalar parameter/arithmetic/command expansions,
with no field splitting, globbing, or tilde expansion. Quotes in body text are
literal; backslashes quote dollar, backtick, and backslash. Backslash-newline
joining precedes delimiter comparison and `<<-` tab stripping. Quoted bodies
are literal. Syntax, including unquoted body substitutions, is validated before
any command or filesystem effects; skipped branches consume bodies without
expanding them. Each executed redirection creates a fresh `ShellInput`; copies
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
`TextDecoder`, replaces invalid UTF-8, removes NUL, and strips trailing LF;
document input is re-encoded as UTF-8. Literal non-ASCII text is preserved,
but non-UTF-8 substitution output is not byte-preserving. Ordinary command
streams still use `Uint8Array` unchanged.

The existing limits apply without new public API: `maxSourceBytes` bounds the
whole source, `maxExpansionBytes` and `maxExpansionFields` bound individual
scalar expansions, and command/substitution/loop/output limits share the
execution budget. The default syntax nesting bound is 64. Document inputs are
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
