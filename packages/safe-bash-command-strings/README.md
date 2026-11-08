# strings

Use this command with virtual files and configurable resource limits.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { stringsCommands } from "@poe-platform/safe-bash/commands/strings";

const fs = createMemoryFileSystem();
await fs.writeFile("/sample.txt", new TextEncoder().encode("hello\n"));
const shell = new Shell({ fs }).use(stringsCommands());
const result = await shell.exec("strings /sample.txt");
await shell.dispose();
```

Also available: `createStringsCommand`, `createStringsCommands`, and typed options and limits.
