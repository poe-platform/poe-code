# Shell compatibility policies

Unsupported execution-mode requests to `set`, including `set -e` and
`set -o errexit`, terminate the current shell execution with status 2 and a
diagnostic. They do not silently continue with the requested safety option
disabled. This is fail-closed rejection, not an implementation of Bash errexit.
As with `exit`, a subshell or pipeline stage has its own execution boundary.
Already completed effects are not rolled back. Supported positional-argument
and pipefail forms remain unchanged.

The shell validates the whole source, including ordinary command substitutions,
before execution. This intentionally differs from incremental Bash parsing.
Shell text uses JavaScript strings; byte stdin/stdout support does not imply
byte-preserving textual expansions for arbitrary non-UTF-8 data.

## Case statements

Case supports quoted subjects and patterns, alternatives, optional opening
parentheses, empty bodies, nesting, compound redirects, and `;;`, `;&`, `;;&`.
Patterns expand lazily, without field splitting or pathname expansion. Matching
includes newline and slash characters and uses C/ASCII POSIX character classes;
locale-specific collation and extended glob operators are not implemented.
The case matcher is iterative, not a backtracking regular expression. Each case
has at most `maxExpansionBytes` matching steps shared across its alternatives,
in addition to ordinary expansion byte limits. Exhaustion raises
`ShellLimitError("maxExpansionBytes")`. Matching periodically yields and checks
cancellation. Nonexecuted patterns/bodies cannot run expansion effects.

`case.test.ts` uses bounded Bash references for syntax supported by installed
Bash 3.2. Modern fallthrough terminators follow the GNU Bash manual and have
explicit expected-result tests: Bash 3.2 rejects them. Case statements inside
command substitutions are parsed structurally, not with Bash 3.2's older
parenthesis-scanning artifacts. No modern Bash installation is claimed.
