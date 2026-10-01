# patch

Run `patch` against an injected virtual filesystem with portable byte streams.

```ts
import { createPatchCommand, patchCommands } from "@poe-platform/safe-bash/commands/patch";

const command = createPatchCommand();
const plugin = patchCommands();
```

Use the command with a `CommandContext`, or install the plugin in a Safe Bash shell. `createPatchCommands()` returns the command definitions without registering them. Limits are optional; omitted quotas are unbounded. Set finite limits for untrusted input.
