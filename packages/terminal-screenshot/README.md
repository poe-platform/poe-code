# @poe-code/terminal-screenshot

Render PNG terminal screenshots from ANSI input.

## API

```ts
import { renderTerminalScreenshot } from "@poe-code/terminal-screenshot";

await renderTerminalScreenshot({
  inputPath: "example.ansi",
  outputPath: "example.png",
  window: true,
  padding: 20
});
```

Options:

- `inputPath`: path to the ANSI input file
- `outputPath`: path to the output PNG file
- `window`: include terminal window chrome
- `padding`: padding around the rendered terminal content

## CLI

```sh
terminal-screenshot <input.ansi> -o <output.png> [--window] [--padding 20]
```
