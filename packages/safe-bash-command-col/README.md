# col

Clean overstruck terminal text in Safe Bash pipelines:

```sh
printf 'ab\bc\n' | col -b    # ac
printf 'ab\bc\tZ\n' | col -bx
```

`col` reads standard input, resolves backspaces, carriage returns and reverse line feeds, and writes lines in forward order. Use `-b` (`--no-backspaces`) to keep the last character at each column, `-x` (`--spaces`) to expand tabs, `-h` (`--tabs`) to compress spaces, and `-p` (`--pass`) to preserve unknown control characters. The last `-h` or `-x` wins. UTF-8 display widths include wide characters. Half-line motion and `-f`/`-l` are not supported.

Available by default in `agentCommands()`, or separately through `colCommands`, `createColCommand`, and `createColCommands` from `@poe-platform/safe-bash/commands/col`. `ColCommandsOptions.limits` controls input, output, retained text, chunk, argument, and work bounds. Defaults admit 16 MiB of input, 32 MiB of output, and 1 MiB of retained text; input is buffered to resolve reverse feeds. Malformed UTF-8 returns an error.
