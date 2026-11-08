# split

Split virtual files or streamed input into smaller files with Safe Bash. Choose
line counts (`-l`), byte counts (`-b`), bounded line windows (`-C`), or chunk
selection/distribution (`-n`). Alphabetic, decimal and hexadecimal suffixes,
explicit suffix widths, custom record separators and empty-file elision (`-e`)
are supported.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { splitCommands } from "@poe-platform/safe-bash/commands/split";

const fs = createMemoryFileSystem();
const shell = new Shell({ fs }).use(splitCommands({
  limits: { maxFiles: 10, maxInputBytes: 65536, maxOutputBytes: 65536 },
}));
try {
  await shell.exec("split -l 1 - /part", { stdin: "one\ntwo\n" });
  console.log(new TextDecoder().decode(await fs.readFile("/partaa"))); // "one\n"
} finally {
  await shell.dispose();
}
```

Limits default to `Infinity`; filesystem streams use 64 KiB reads unless you
configure a finite `maxChunkBytes`. Additional limits bound buffering, argument
bytes, suffix length and processing steps. Invocation limits can tighten the
registered limits. Use `split --help` for options.

The public module exports `createSplitCommand`, `createSplitCommands`,
`splitCommands`, `SplitCommandsOptions` and `SplitLimits`. Registration rejects
collisions unless you pass `replace: true`. This internal workspace is bundled
into Safe Bash; consumers use the public imports above.
