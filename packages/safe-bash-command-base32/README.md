# base32

Run `base32` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { base32Commands } from "@poe-platform/safe-bash/commands/base32";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(base32Commands());
const result = await shell.exec("base32 --help");
```

The module also exports `createBase32Command`, its command-list factory, and typed options and limits.
