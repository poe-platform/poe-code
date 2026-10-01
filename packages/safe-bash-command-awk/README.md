# awk

Run `awk` against an injected virtual filesystem with portable byte streams.

```ts
import { createAwkCommand, awkCommands } from "@poe-platform/safe-bash/commands/awk";

const command = createAwkCommand();
const plugin = awkCommands();
```

Use the command with a `CommandContext`, or install the plugin in a Safe Bash shell. `createAwkCommands()` returns the command definitions without registering them. Limits are optional; omitted quotas are unbounded. Set finite limits for untrusted input.
