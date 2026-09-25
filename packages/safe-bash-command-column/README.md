# Format tables with column

Align space-separated or delimited text, add headings, or produce JSON tables in a virtual filesystem. This internal workspace is bundled into Safe Bash; use its public exports.

```ts
import { Shell, createMemoryFileSystem, standardCommands } from "@poe-platform/safe-bash";
import { columnCommands } from "@poe-platform/safe-bash/commands/column";

const fs = createMemoryFileSystem();
await fs.writeFile("/rows", new TextEncoder().encode("a 1\nlong 2\n"));
const shell = new Shell({ fs }).use(standardCommands()).use(columnCommands());
console.log((await shell.exec("column -t /rows")).stdout);
await shell.dispose();
```

| Options | Result |
| --- | --- |
| `-t`, `-s`, `-o` | Align fields with selected input/output separators |
| `-N`, `-C`, `-O`, `-H` | Name, configure, reorder, or hide columns |
| `-R`, `-T`, `-W`, `-E` | Right alignment, truncation, wrapping, or extreme-cell handling |
| `-J`, `-n` | JSON tables with named columns and an optional table name |
| `-c`, `-x` | Set output width and fill across rows |
| `--help` | Show the supported option profile |

`createColumnCommand` and `createColumnCommands` provide command definitions for custom registries. `columnCommands({ replace: true })` replaces an existing registration. Input is strict UTF-8 with deterministic scalar widths and tab stops; terminal, locale, ANSI, color, and tree-mode detection are excluded.

Supply `limits` to bound input, output, diagnostics, rows, cells, fields, records, files, work, arguments, width, and retained storage. Defaults retain the existing 10,000-row, 50,000-cell, 1,000-field and 8 MiB retained-storage limits. Resource admission precedes cell and padding allocation; writes preserve backpressure and cancellation. Read stdin or VFS operands, including pipelines and virtual scripts, without implicit host or network access.
