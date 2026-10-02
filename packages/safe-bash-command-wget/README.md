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

The supported download profile includes `-O` output documents, `-P` directories,
`-i` URL lists (including stdin), redirects, retries, timeouts, `--spider`,
`--continue`, `--no-clobber`, request headers and POST bodies. Downloads write to
the injected filesystem; `-O -` streams to stdout. Recursive mirroring is
unsupported. Cancellation waits for response cleanup before settling.

This workspace is internal. Use the public Safe Bash exports shown above;
consumers do not install the command or its shared network engine separately.
