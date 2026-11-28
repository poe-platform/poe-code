# file

Run `file` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Use `file -b --mime-type PATH` to identify content, including SVG, WAV, WebP, BMP, MP4, ELF, 7z, and RAR headers, regardless of the filename. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { fileCommands } from "@poe-platform/safe-bash/commands/file";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(fileCommands());
const result = await shell.exec("file --help");
```

The module also exports `createFileCommand`, its command-list factory, and typed options and limits.
