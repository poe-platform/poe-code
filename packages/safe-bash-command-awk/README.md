# awk

Run `awk` against an injected virtual filesystem with portable byte streams.

Transform text with `gensub`, sort arrays with `asort` and `asorti`, format epoch
timestamps with `strftime` and `mktime`, and use GNU-style bitwise functions.
Command pipes (`command | getline` and `print ... | command`) run through the
virtual shell, with bounded streams and `close(command)` support.

```ts
import { createAwkCommand, awkCommands } from "@poe-platform/safe-bash/commands/awk";

const command = createAwkCommand();
const plugin = awkCommands();
```

Use the command with a `CommandContext`, or install the plugin in a Safe Bash shell. `createAwkCommands()` returns the command definitions without registering them. Limits are optional; omitted quotas are unbounded. Set finite limits for untrusted input.
