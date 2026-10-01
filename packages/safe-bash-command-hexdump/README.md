# hexdump

Use this command with virtual files and configurable resource limits.

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
