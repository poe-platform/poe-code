# base64

Run `base64` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { base64Commands } from "@poe-platform/safe-bash/commands/base64";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(base64Commands());
const result = await shell.exec("base64 --help");
```

The module also exports `createBase64Command`, its command-list factory, and typed options and limits.
