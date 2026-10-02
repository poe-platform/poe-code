# truncate

Run `truncate` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { truncateCommands } from "@poe-platform/safe-bash/commands/truncate";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(truncateCommands());
const result = await shell.exec("truncate --help");
```

The module also exports `createTruncateCommand`, its command-list factory, and typed options and limits. These portable factories support filesystems with `stat`, `truncate`, and append-style creation. The shell default uses `truncateCommand`, which requires retained resize handles or an atomic resize operation so changes keep the admitted file identity. Both paths share size arithmetic, cancellation, and resource accounting.

Supported options include `--size` (`-s`), `--reference` (`-r`), `--io-blocks`
(`-o`) and `--no-create` (`-c`). Sizes support suffixes and relative, minimum,
maximum and rounding modifiers. Existing permissions are retained; creation
honors the configured or shell creation mask.

`ioBlockSize` and `seekEnd` let applications supply missing filesystem metadata.
Optional `maxArgumentBytes`, `maxArguments`, `maxOutputBytes` and `maxEntries`
limits bound each invocation; omitted or `undefined` limits remain unlimited.
Registration rejects an existing `truncate` command unless `replace: true` is
explicitly supplied. This internal workspace is included in the parent bundle
and is not installed separately.
