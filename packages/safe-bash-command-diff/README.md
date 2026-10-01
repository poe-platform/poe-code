# diff

Run `diff` against an injected virtual filesystem with portable byte streams.

```ts
import { createDiffCommand, diffCommands } from "@poe-platform/safe-bash/commands/diff";

const command = createDiffCommand();
const plugin = diffCommands();
```

Use the command with a `CommandContext`, or install the plugin in a Safe Bash shell. `createDiffCommands()` returns the command definitions without registering them. Limits are optional; omitted quotas are unbounded. Set finite limits for untrusted input.
