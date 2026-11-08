# hexdump

Inspect virtual-file or stdin bytes with `hexdump` and its canonical-display alias
`hd`. Use the existing public Safe Bash exports; this implementation workspace
is private and bundled into Safe Bash.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { hexdumpCommands } from "@poe-platform/safe-bash/commands/hexdump";

const fs = createMemoryFileSystem();
await fs.writeFile("/sample.txt", new TextEncoder().encode("hello\n"));
const shell = new Shell({ fs }).use(hexdumpCommands());
const result = await shell.exec("hexdump -C /sample.txt");
await shell.dispose();
```

Also available: `createHexdumpCommand`, `createHexdumpCommands`, and typed options and limits.

Use `-e` for custom byte layouts, for example `hexdump -e '4/1 "%02x " "\n"'`.
Formats support repetition and byte counts, integer and floating-point conversions,
strings and characters, address conversions, and multiple `-e` options in order.
Format files (`-f`) are not supported. Configure `limits` to bound input, output,
buffered memory, format counts, and work when processing untrusted formats.

Use `-C` for canonical hex/ASCII, `-b`, `-c`, `-d`, `-o` or `-x` for
standard display units, `-s` to skip bytes, `-n` to limit input and `-v` to
disable repeated-row squeezing. Multiple files form one input stream. `hd`
selects canonical display by default. The plugin registers both names and
rejects collisions before registration; pass `replace: true` to replace both.

The `dialect` option selects `bsd` or `util-linux`. Command limits are opt-in
and default to `Infinity`; finite positive integer limits bound arguments,
argument bytes, input, buffered memory, output, diagnostics, format count, work
and empty input chunks. Shell limits and cancellation still apply. Both aliases
use the same limits. The command accesses only the supplied virtual filesystem
and streams, with no host process or network capability.
