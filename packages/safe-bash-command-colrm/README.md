# colrm

Remove a range of display columns from every input line:

```sh
printf 'abcdef\n' | colrm 2 4  # aef
printf 'abcdef\n' | colrm 2    # a
```

Columns start at one and both endpoints are inclusive. Omitting the end column (or passing zero) removes the rest of each line. With no operands or a zero start, input passes through unchanged. Tabs use eight-column stops, backspaces move back one column, and UTF-8 wide characters occupy two columns. A tab or wide character cut in half leaves spaces for its retained columns. Newlines and a missing final newline are preserved.

Available by default in `agentCommands()`, or separately through `colrmCommands`, `createColrmCommand`, and `createColrmCommands` from `@poe-platform/safe-bash/commands/colrm`. `ColrmCommandsOptions.limits` bounds input, output, chunks, arguments, and work. Defaults admit 16 MiB of input and 32 MiB of output. Malformed UTF-8 returns an error when filtering columns; pass-through mode preserves arbitrary bytes.
