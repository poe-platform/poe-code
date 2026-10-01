# zip

Run `zip` against an injected virtual filesystem with portable byte streams.

```ts
import { createZipCommand, zipCommands } from "@poe-platform/safe-bash/commands/zip";

const command = createZipCommand();
const plugin = zipCommands();
```

Use the command with a `CommandContext`, or install the plugin in a Safe Bash shell. `createZipCommands()` returns the command definitions without registering them. Limits are optional; omitted quotas are unbounded. Set finite limits for untrusted input.
