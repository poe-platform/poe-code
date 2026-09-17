# Injecting a Safe Bash timezone

Safe Bash already supports an explicit per-shell timezone; it does not infer a
user's timezone from the server. This applies to the virtual `date` command,
not the host process or a separate browser context.

```ts
import { Shell, MemoryFileSystem, agentCommands } from '@poe-platform/safe-bash';

const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands({
  timeEnv: { defaultTimeZone: 'America/New_York' },
}));
try {
  const result = await shell.exec('date');
  console.log(result.stdout);
} finally {
  await shell.dispose();
}
```

Alternatively, inject `env: { TZ: 'America/New_York' }` in the `Shell` constructor.
For a single invocation, use `TZ=Asia/Kolkata date`. No host `process.env` mutation
is required. The `timeEnvCommands` plugin and `createTimeEnvCommands` factory also
accept `defaultTimeZone` directly when the aggregate agent plugin is not needed.

Precedence is `date -u` / `--utc`, then the virtual `TZ` environment variable,
then `defaultTimeZone`, then UTC. An explicitly empty `TZ` selects UTC. Invalid
zone identifiers are rejected rather than silently using server time. Supported
IANA names use the runtime's Intl timezone data, including daylight-saving
offsets. The optional `timeEnv.clock: () => number` supplies epoch milliseconds
for deterministic application clocks or testing; timezone configuration changes
the representation, not the underlying instant.

Issue #732's sample instant, September 16, 2026 at 19:40:48 UTC, displays as
15:40:48 EDT with `America/New_York` or September 17 at 01:10:48 with
`Asia/Kolkata`. Public API regressions cover the sample, UTC overrides, seasonal
offsets, invalid identifiers and simultaneous shell isolation. No runtime fix was
needed: the existing supported injection paths satisfy the request.
