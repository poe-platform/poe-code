# safe-bash-mcp

A stdio MCP server exposing `shell_execute` through safe-bash. It interprets
Bash in a virtual filesystem; it does not launch the host's shell or inherit
the host's environment. The default filesystem is empty and in memory.

## MCP client configuration

```json
{
  "mcpServers": {
    "safe-bash": {
      "command": "poe-safe-bash-mcp",
      "args": []
    }
  }
}
```

`shell_execute` accepts `command` (required, nonempty Bash source), `cwd`
(virtual working directory), `env` (string-valued environment overrides), and
`stdin` (text). Unknown arguments are rejected. It returns `stdout`, `stderr`,
and `exitCode` in both MCP structured content and a JSON text block. A nonzero
exit sets `isError: true`; runtime exceptions become MCP tool errors.

Calls execute in arrival order and share files for the server's lifetime.
As with `Shell.exec`, each call starts from the configured cwd and environment:
`cd`, variables, and exports do not persist to the next call. Separate server
instances have separate default filesystems. Nothing is persisted on shutdown.

## SDK and configuration

```js
import { createSafeBashMcpServer } from "poe-code/safe-bash-mcp";

const server = createSafeBashMcpServer({
  cwd: "/",
  env: { PROJECT: "demo" },
  limits: { maxCommands: 100, maxOutputBytes: 1048576 }
});
try {
  await server.listen();
} finally {
  await server.close();
}
```

`SafeBashMcpOptions` exposes:

| Option | Default | Purpose |
| --- | --- | --- |
| `fs` | New in-memory filesystem | Existing safe-bash/safe-fs filesystem, shared with every execution. |
| `commands` | `createStandardCommands()` registry | Explicit command registry; replaces the default command set. |
| `cwd` | `/` | Initial virtual working directory. Create it in `fs` before use. |
| `env` | Empty | Initial shell environment; no automatic `process.env` import. |
| `limits` | safe-bash defaults | Shell execution budgets, described below. |
| `createShell` | `options => new Shell(options)` | Synchronous factory called once with resolved `ShellOptions`, including the filesystem and command registry. Use it to install plugins or an injected SafeJS-backed command. |

`limits` supports `maxOutputBytes`, `maxCommands`, `maxLoopIterations`,
`maxSubstitutionDepth`, `maxSourceBytes`, `maxExpansionFields`,
`maxExpansionBytes`, and `pipeHighWaterMark`. They retain safe-bash's meanings,
validation, and defaults. Tool callers cannot override these server budgets,
the runtime factory, command registry, or filesystem.

For CLI/SDK parity, `poe-safe-bash-mcp --config /absolute/path/config.mjs` loads a
module whose default export is the same `SafeBashMcpOptions` object. The module
can construct a shared filesystem, command registry, or runtime factory. This
is trusted startup code, not sandboxed guest code: never load an untrusted
config module or print to stdout from it. All stdout is reserved for MCP.
There are no package-specific environment variables.

For example, a config module can enable `node` using the public SafeJS runtime
while preserving the shell's virtual filesystem and I/O:

```js
import { Shell, nodeCommands } from "poe-code/safe-bash";
import { Budget, run, makeFsModule, declareHostOperation } from "poe-code/safe-js";

export default {
  createShell: options => new Shell(options).use(nodeCommands({
    runtime: {
      run,
      makeFsModule,
      declareHostOperation,
      createBudget: limits => new Budget(limits)
    }
  }))
};
```

The default command set does not enable `node`; this example explicitly grants
the SafeJS implementation, not native Node.js or native module access.

The returned server exposes the underlying `shell`, an idempotent `close()`, and
the MCP server's `listen`, `connect`, and `connectSDK` transports. `listen` and
`connect` cancel active execution and reject queued calls immediately on input
EOF, input/output closure, or transport error, before draining requests. They
remove their transport listeners after cleanup. Clients must keep input open
until their requests finish; EOF is disconnect, not a request to flush work.
SDK callers using `handleMessage` or `connectSDK` own shutdown through `close()`.
Injected commands
and filesystems define granted capabilities. Host filesystem or network access
is not enabled by default, and unregistered commands do not fall back to host
executables. Runtime plugins must enforce their own capability boundaries.
