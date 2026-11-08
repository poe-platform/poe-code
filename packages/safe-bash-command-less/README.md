# safe-bash-command-less

Read virtual files or piped text with `less` inside `@poe-platform/safe-bash`.
`maxInputBytes` defaults to `Infinity`; set a finite value to limit buffered
input. Explicit `Infinity` disables the quota.

Unformatted output preserves file and stdin bytes, including binary data; multiple
files are concatenated without inserting newlines. Use `-N` for line numbers,
`-s` to squeeze blank lines, `+LINE` to start at a line, and `-p PATTERN` or
`+/PATTERN` for regular-expression search (`-i` ignores case). `-x` and `-z`
require numeric values; invalid values fail rather than silently selecting stdin.
