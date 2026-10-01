# gzip

Run `gzip` against an injected virtual filesystem with portable byte streams.

```ts
import { createGzipCommand, gzipCommands } from "@poe-platform/safe-bash/commands/gzip";

const command = createGzipCommand();
const plugin = gzipCommands();
```

Use the command with a `CommandContext`, or install the plugin in a Safe Bash shell. `createGzipCommands()` returns the command definitions without registering them. Limits are optional; omitted quotas are unbounded. Set finite limits for untrusted input.

The plugin registers `gzip`, `gunzip`, and `zcat`; `maxDecodedBytes` bounds decompression.
