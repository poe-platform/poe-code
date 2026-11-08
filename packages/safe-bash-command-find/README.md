# find

Run `find` against an injected virtual filesystem with portable byte streams.

```ts
import { createFindCommand, findCommands } from "@poe-platform/safe-bash/commands/find";

const command = createFindCommand();
const plugin = findCommands();
```

Use the command with a `CommandContext`, or install the plugin in a Safe Bash shell. `createFindCommands()` returns the command definitions without registering them. Limits are optional; omitted quotas are unbounded. Set finite limits for untrusted input.

`find -exec` uses the context’s `invoke` capability, or an explicit `execute` handler. It never starts host processes. `limits.maxDirectoryEntries` bounds directory admission.
