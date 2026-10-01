# unzip

Run `unzip` against an injected virtual filesystem with portable byte streams.

```ts
import { createUnzipCommand, unzipCommands } from "@poe-platform/safe-bash/commands/unzip";

const command = createUnzipCommand();
const plugin = unzipCommands();
```

Use the command with a `CommandContext`, or install the plugin in a Safe Bash shell. `createUnzipCommands()` returns the command definitions without registering them. Limits are optional; omitted quotas are unbounded. Set finite limits for untrusted input.
