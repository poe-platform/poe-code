# html-to-markdown

Run `html-to-markdown` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { htmlToMarkdownCommands } from "@poe-platform/safe-bash/commands/html-to-markdown";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(htmlToMarkdownCommands());
const result = await shell.exec("html-to-markdown --help");
await shell.dispose();
```

The module also exports `createHtmlToMarkdownCommand`, its command-list factory, and typed options and limits.

`maxInputBytes` bounds cumulative source bytes. `maxWorkUnits` bounds processing across decoding, parsing, attribute handling and rendering, so its cost can exceed the input size. Discarded comments use constant parser storage while remaining subject to input, token-count and work limits. Document records and rendered text use a 256 KiB page cache and spill through the supplied filesystem. Spill files use `TMPDIR` (or the command working directory) and require retained positioned read/write handles and conditional removal. A memory filesystem still stores spilled data in RAM. Unfinished tokens, open tags, recursive traversal and URL validation can still grow; this is not yet a complete bounded-memory Worker qualification.

Pass VFS filenames or `-` for shared stdin; `--` ends option parsing. The converter
supports headings, paragraphs, emphasis, links, images, lists, quotes, code and
tables. Scripts, styles and comments are discarded without fetching or executing
anything. Malformed input follows the supported HTML subset; this is not a
browser HTML5 parser or a sanitizer.

Factory limits default to `Infinity`; configure finite limits for untrusted
input. Shell command limits can tighten them. Output limits count UTF-8 bytes,
and cancellation preserves the caller's abort reason. The public module supports
the parent package's Node, browser and workerd profiles with supplied virtual IO.
This workspace is internal and bundled into Safe Bash; use the public imports
above without installing a separate command package.
