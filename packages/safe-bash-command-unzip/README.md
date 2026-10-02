# unzip

List, test and extract ZIP archives in an injected virtual filesystem, or stream
selected members into a shell pipeline.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { unzipCommands } from "@poe-platform/safe-bash/commands/unzip";

const fs = createMemoryFileSystem();
// Supply your archive bytes through the filesystem.
await fs.writeFile("/archive.zip", archiveBytes);
const shell = new Shell({ fs }).use(unzipCommands({
  limits: { maxArchiveBytes: 16 * 1024 * 1024, maxTotalBytes: 64 * 1024 * 1024 },
}));
const result = await shell.exec("unzip -o -d /extracted /archive.zip");
await shell.dispose();
```

Supported operations include listing (`-l`, `-v`, `-Z1`), integrity testing (`-t`),
member streaming (`-p`, `-c`), include/exclude patterns (`-x`), case-insensitive
matching (`-C`), destination selection (`-d`), overwrite policy (`-o`, `-n`),
update/freshen (`-u`, `-f`), and flattened paths (`-j`). Unsafe member paths and
escaping symlinks are rejected; extraction uses staged publication and retained
cleanup. Filesystem backends must support the required safe publication operations.

`createUnzipCommand()` returns one definition; `createUnzipCommands()` returns the
family; `unzipCommands()` registers it. Duplicate registration fails unless
`replace: true` is supplied. The default command inventory already includes unzip.

Limits are optional and omitted quotas remain unbounded. `UnzipLimits` covers
archive, input memory, entry and total bytes, member count, path depth/bytes,
argument bytes, pattern work and diagnostic/output buffering. Finite limits are
recommended for untrusted archives. Node and portable browser/workerd consumers
use the same public exports with injected filesystem and stream capabilities.
This implementation is bundled internally; no separate command package install
is required.
