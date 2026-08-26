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
