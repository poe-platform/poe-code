# unzip

List, test and extract ZIP archives in an injected virtual filesystem, or stream
selected members into a shell pipeline. Use `unzip -p -` to read an archive from stdin.

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
cleanup. ZIP files use retained ranges; stdin, nonseekable archives and authenticated
plaintext use owned staging in the injected filesystem. Large streams need an
external backend with retained reads, retained staged writes and cleanup; a memory
filesystem still stores its contents in RAM. Qualified backends also keep member indexes
and deferred extraction metadata in owned backing storage. Read-only backends retain
the compatible buffered metadata path for smaller archives. Filesystem backends must support the
required safe publication operations. Directory indexes and deferred extraction metadata spill through bounded caches on this profile. Read-only backends without scratch capabilities retain the compatibility buffering path.

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
