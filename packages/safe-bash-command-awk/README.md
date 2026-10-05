# awk

Use `awk --help` (or `awk -h`) for command usage.

Run `awk` against an injected virtual filesystem with portable byte streams. Regular expressions count UTF-8 characters by default and in UTF-8 locales; C/POSIX locales retain byte matching. Use `-b` or `--characters-as-bytes` to force byte matching. String indexes and other string operations remain byte-oriented.

Transform text with `gensub`, sort arrays with `asort` and `asorti`, format epoch
timestamps with `strftime` and `mktime`, and use GNU-style bitwise functions.
Command pipes (`command | getline` and `print ... | command`) run through the
virtual shell, with bounded streams and `close(command)` support.
Use `fflush()`, `fflush("")`, or `fflush("/dev/stdout")` to publish pending stdout.
Output also flushes before awaiting another input chunk. `fflush(filename)` returns
`0` for an open output and `-1` for an unknown output without closing it.

```ts
import { createAwkCommand, awkCommands } from "@poe-platform/safe-bash/commands/awk";

const command = createAwkCommand();
const plugin = awkCommands();
```

Use the command with a `CommandContext`, or install the plugin in a Safe Bash shell. `createAwkCommands()` returns the command definitions without registering them. Limits are optional; omitted quotas are unbounded. Set finite limits for untrusted input.
