# du

Measure virtual filesystem usage with `du`: recursive totals, apparent bytes,
provider-reported allocation, inode counts, exclusions, symlink traversal and
hardlink deduplication scoped to filesystem identity.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { duCommands } from "@poe-platform/safe-bash/commands/du";

const fs = createMemoryFileSystem();
await fs.writeFile("/payload", new Uint8Array(1024));
const shell = new Shell({ fs }).use(duCommands({
  limits: { maxEntries: 10000, maxOutputBytes: 65536 },
}));
try {
  const result = await shell.exec("du -b /payload");
  console.log(result.stdout); // 1024\t/payload\n
} finally {
  await shell.dispose();
}
```

Use `-b` for apparent bytes, `-s` for a summary, `-a` for file rows, `-h` for
human-readable sizes, `--exclude` to skip matches, and `-L` to follow symlinks.
Default allocation reporting requires the filesystem's `allocatedBytes` metadata;
unknown allocation produces a diagnostic and suppresses incomplete totals.

`createDuCommand`, `createDuCommands`, `duCommands`, `DuCommandsOptions` and
`DuLimits` are available through the public command export. Registration rejects
collisions unless `replace: true` is supplied. Optional limits bound arguments,
argument bytes, entries, directory entries, depth, path bytes, metadata bytes,
output bytes and work steps. Omitted limits retain the existing unbounded defaults.
Node, browser and workerd exports use the supplied filesystem and cancellation
signal. This internal workspace is bundled into Safe Bash; no separate install
is required.
