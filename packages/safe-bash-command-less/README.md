# safe-bash-command-less

Read virtual files or piped text with `less` inside `@poe-platform/safe-bash`.
`maxInputBytes` defaults to `Infinity`; set a finite value to limit buffered
input. Explicit `Infinity` disables the quota.
