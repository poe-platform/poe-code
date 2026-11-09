# paste

Run `paste` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs. GNU-style unique prefixes are accepted for `--serial`, `--delimiters`, and `--zero-terminated`, including attached delimiter values such as `--delim=:`.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { pasteCommands } from "@poe-platform/safe-bash/commands/paste";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(pasteCommands());
const result = await shell.exec("paste --help");
```

The module also exports `createPasteCommand`, its command-list factory, and typed options and limits.
