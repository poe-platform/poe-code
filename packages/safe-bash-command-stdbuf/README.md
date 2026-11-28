# stdbuf

Run commands using familiar buffering options in Safe Bash:

```sh
printf 'a\n' | stdbuf -oL cat
stdbuf -o0 -e0 echo hi
```

`-i`/`--input`, `-o`/`--output`, and `-e`/`--error` accept `0` or a byte
size with optional binary or decimal units. Output and error also accept `L`.
Buffering modes are validated and otherwise ignored: virtual streams retain
their existing behavior. Arguments, streams, and the command's exit status are
preserved. Invalid options return status 125.

Included in `agentCommands()`. For individual registration, import
`stdbufCommands` from `@poe-platform/safe-bash/commands/stdbuf`.
`limits.maxArgumentBytes` optionally bounds argument processing.
