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

## Configuration Options

- `output`: path to the output PNG file
- `window`: include terminal window chrome
- `padding`: padding around the rendered terminal content

## CLI

```sh
terminal-png <input.ansi> -o <output.png> [--window] [--padding 20]
```

## Environment Variables

This package does not read public environment variables. The comparison script inherits `PATH` only to locate the local CLI under test.
