# tar

Run `tar` against an injected virtual filesystem with portable byte streams.

```ts
import { createTarCommand, tarCommands } from "@poe-platform/safe-bash/commands/tar";

const command = createTarCommand();
const plugin = tarCommands();
```

Use the command with a `CommandContext`, or install the plugin in a Safe Bash shell. `createTarCommands()` returns the command definitions without registering them. Limits are optional; omitted quotas are unbounded. Set finite limits for untrusted input.
