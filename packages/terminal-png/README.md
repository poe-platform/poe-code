# terminal-png

Render PNG images from ANSI terminal output.

## API

```ts
import { renderTerminalPng } from "terminal-png";

await renderTerminalPng(ansiText, {
  output: "example.png",
  window: true,
  padding: 20
});
```

Options:

- `output`: path to the output PNG file
- `window`: include terminal window chrome
- `padding`: non-negative integer padding around the rendered terminal content

The ANSI parser supports common SGR styling, cursor positioning and movement, save/restore cursor,
erase-in-line/display, tabs, double-width characters, and combining marks. Parsed terminal state is
bounded to 1000 rows by 1000 columns to avoid unbounded renders from hostile control sequences.

## CLI

```sh
terminal-png <input.ansi> -o <output.png> [--window] [--padding 20]
```

`--output` must be non-empty. `--padding` accepts decimal integers only, with no negative values or
leading zeroes except `0`.

## Environment variables

This package exposes no environment variables.

## Configuration

There are no package-level config files. Configure renders with API options or CLI flags.
