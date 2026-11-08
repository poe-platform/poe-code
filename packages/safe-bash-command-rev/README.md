# rev

Use this command with virtual files and configurable resource limits.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { revCommands } from "@poe-platform/safe-bash/commands/rev";

const fs = createMemoryFileSystem();
await fs.writeFile("/sample.txt", new TextEncoder().encode("hello\n"));
const shell = new Shell({ fs }).use(revCommands());
const result = await shell.exec("rev /sample.txt");
await shell.dispose();
```

Also available: `createRevCommand`, `createRevCommands`, and typed options and limits.
