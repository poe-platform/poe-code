# svgo

Optimize SVG files and streams inside Safe Bash.

```ts
import { svgoCommands } from "@poe-platform/safe-bash/commands/svgo";
shell.use(svgoCommands());
await shell.exec("svgo diagram.svg -o small.svg --multipass -p 2");
```

Accepts a positional input, `-i FILE`, `-s STRING`, or `-` for stdin. File input is optimized in place by default; strings and stdin write to stdout. `-o -` explicitly selects stdout. `--pretty` and `--indent 0..16` format element-only content without adding whitespace to labels; `-p 0..15` controls numeric precision. `--multipass` runs up to ten passes. `-q`/`--quiet` are accepted; output is quiet by default.

The optimizer removes comments/metadata, rounds geometry, compacts paths and collapses redundant groups. It is not a sanitizer. Input and output byte limits are configurable through `svgoCommands({ limits })`.
