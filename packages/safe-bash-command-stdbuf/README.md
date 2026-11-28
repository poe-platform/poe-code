# stdbuf

Run commands that use buffering options in a virtual shell:

```sh
printf 'a\n' | stdbuf -oL cat
stdbuf -o0 -e0 echo hi
```

Supports `-i`, `-o`, `-e`, `--input`, `--output`, and `--error` with
`0`, output line buffering (`L`), or buffer sizes. Modes are validated but
have no effect on virtual streams. The wrapped command keeps its arguments,
input, output, and exit status.

Use `createStdbufCommand`, `createStdbufCommands`, or the `stdbufCommands`
plugin. `StdbufCommandsOptions.limits.maxArgumentBytes` bounds argument bytes
(default: 1 MiB).
