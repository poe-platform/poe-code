# html-to-markdown

Run `html-to-markdown` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { htmlToMarkdownCommands } from "@poe-platform/safe-bash/commands/html-to-markdown";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(htmlToMarkdownCommands());
const result = await shell.exec("html-to-markdown --help");
```

The module also exports `createHtmlToMarkdownCommand`, its command-list factory, and typed options and limits.
