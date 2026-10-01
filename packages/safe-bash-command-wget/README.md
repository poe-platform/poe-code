# wget

Run `wget` against an injected virtual filesystem with portable byte streams.

```ts
import { createWgetCommand, wgetCommands } from "@poe-platform/safe-bash/commands/wget";

const command = createWgetCommand();
const plugin = wgetCommands();
```

Use the command with a `CommandContext`, or install the plugin in a Safe Bash shell. `createWgetCommands()` returns the command definitions without registering them. Limits are optional; omitted quotas are unbounded. Set finite limits for untrusted input.

Requests are denied by default. Supply an `authorize` callback and, when needed, an explicit HTTP `transport`. Authorization applies to every redirect. The default transport uses Fetch.

```ts
const authorized = createWgetCommand({
  authorize: ({ url }) => new URL(url).origin === "https://example.com",
  limits: { maxDownloadBytes: 1024 * 1024 },
});
```
