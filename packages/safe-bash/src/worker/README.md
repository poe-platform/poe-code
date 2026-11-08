# Worker timeout profile

Node `Shell` gives `timeout -k` a terminable execution boundary. Standard
`agentCommands()` configurations are enrolled by command-function identity and
replayed inside the worker. Child byte argv, environment, cwd, creation mask and
ignored signals retain their caller values. Filesystem effects run through the
configured caller adapter; no ambient filesystem or native shell is substituted.
The bridge retains the caller's device namespace and invocation-owned filesystem
budget and cancellation signal, including when other shells share its adapter.
Worker-local filesystem signals cross the bridge too. Ordinary nested timeouts
cancel their own pathname operations and streams while the outer worker continues.

For trusted custom plugins, declare matching worker factories:

```ts
const shell = new Shell({
  fs,
  workerModules: [{ specifier: new URL("./commands.js", import.meta.url).href,
    exportName: "customCommands", options: { /* transferable configuration */ } }],
});
shell.use(agentCommands()).use(customCommands({ /* same configuration */ }));
```

Factories return plugins or extensions. They must reproduce host command names
and behavior, middleware and capability bindings. They are trusted JavaScript,
not sandboxed provider code. Arbitrary host closures cannot be serialized.

The controller closes RPC admission, aborts cooperative bridge work, terminates
the worker and drains admitted work before settlement. Previously completed
effects remain. Pathname methods and streaming reads cross the bridge; retained
handles and atomic publication factories are unavailable. See the
[timeout profile](../commands/timeout/README.md) for shared-quota admission,
portable hosts, nested escalation, statuses and signal semantics.
