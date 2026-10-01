# sed

Run `sed` against an injected virtual filesystem with portable byte streams.

```ts
import { createSedCommand, sedCommands } from "@poe-platform/safe-bash/commands/sed";

const command = createSedCommand();
const plugin = sedCommands();
```

Use the command with a `CommandContext`, or install the plugin in a Safe Bash shell. `createSedCommands()` returns the command definitions without registering them. Limits are optional; omitted quotas are unbounded. Set finite limits for untrusted input.
