# rev

Use this command with virtual files and configurable resource limits.

Lines are reversed by UTF-8 character by default. Locale overrides follow `LC_ALL`, `LC_CTYPE`, then `LANG`; `C` and `POSIX` reverse raw bytes.

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
