# safe-bash-command-more

Read virtual files or piped bytes with `more` in `@poe-platform/safe-bash`.
Use `moreCommands()` to register only `more`, or `createMoreCommand()` for a command definition.

`more -N file` numbers lines, `more -s file` squeezes blank lines, and
`more +3 file` starts at line three. Unformatted output preserves binary bytes.
Input limits are disabled by default; opt in with
`moreCommands({ limits: { maxInputBytes: 1048576 } })`.
