# which

Use this command with virtual files and configurable resource limits.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { whichCommands } from "@poe-platform/safe-bash/commands/which";

const fs = createMemoryFileSystem();
await fs.writeFile("/demo", new Uint8Array(), { mode: 0o755 });
const shell = new Shell({ fs }).use(whichCommands());
const result = await shell.exec("which /demo");
await shell.dispose();
```

Also available: `createWhichCommand`, `createWhichCommands`, and typed options and limits.
