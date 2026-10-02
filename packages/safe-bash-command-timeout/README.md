# timeout

Run `timeout` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { timeoutCommands } from "@poe-platform/safe-bash/commands/timeout";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(timeoutCommands());
const result = await shell.exec("timeout --help");
```

The module also exports `createTimeoutCommand`, its command-list factory, and typed options and limits.

Durations support seconds and the `s`, `m`, `h`, and `d` suffixes. A zero duration
runs the child without a deadline. Child output and exit status are preserved;
cooperative expiry returns 124 unless `--preserve-status` is selected. Parent
cancellation retains its original reason.

Configure `limits.maxArguments`, `limits.maxArgumentBytes`, and
`limits.maxOutputBytes` through the factory or plugin options. These limits
bound timeout's own work; children retain their own budgets. Defaults are
unlimited. Hosts can inject a scheduler and a trusted `killAfterPolicy`;
nonzero `--kill-after` requires that policy when a deadline is active. The
portable command does not create native processes or provide hard termination
on its own. Registration rejects collisions unless `replace: true` is supplied.
