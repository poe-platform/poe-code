# zip

Run `zip` against an injected virtual filesystem with portable byte streams.

```ts
import { createZipCommand, zipCommands } from "@poe-platform/safe-bash/commands/zip";

const command = createZipCommand();
const plugin = zipCommands();
```

Use the command with a `CommandContext`, or install the plugin in a Safe Bash shell. `createZipCommands()` returns the command definitions without registering them. Limits are optional; omitted quotas are unbounded. Set finite limits for untrusted input.

Archive sources can use S3, WebDAV, or custom filesystems without retained read handles. These reads verify canonical paths, sizes, and timestamps before and after consumption; they cannot provide a snapshot against concurrent changes. Existing-archive replacement still requires backing identity. New destinations without staging require exclusive creation and buffer the archive within `maxBufferedFileBytes` and `maxArchiveBytes`.

ZIP directories and existing members use retained range reads. Nonseekable archives, compression candidates, split output and authenticated plaintext use owned staging in the injected filesystem. AES encryption and payload serialization are incremental. For large archives, inject external storage with retained reads, retained staged writes, retained cleanup and safe publication; a memory filesystem retains stored archive bytes in RAM. On that storage profile, directory validation, member selection and serialization metadata spill through bounded caches. Backends without scratch capabilities retain the compatibility buffering path and are not suitable for large Worker archives. Buffered codec helpers remain available for callers that already own complete byte arrays.
