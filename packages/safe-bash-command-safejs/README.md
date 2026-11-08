# SafeJS command bridge

Run JavaScript against a virtual filesystem through Safe Bash's existing Node
command API. The bridge handles source selection, byte streams, output rendering,
cooperative cancellation, and explicitly configured interpreter and I/O budgets.

```ts
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { nodeCommands } from "@poe-platform/safe-bash/commands/node";

// runtime supplies run, createBudget, makeFsModule, and declareHostOperation.
const shell = new Shell({ fs: new MemoryFileSystem() });
shell.use(nodeCommands({ runtime, limits: { maxSourceBytes: 1024 * 1024 } }));
await shell.exec('node -e "console.log(42)"');
await shell.dispose();
```

The injected runtime remains independent of this bridge. Omitted bridge quotas
remain unlimited. Source, stdin, and stdout budgets are separate; cancellation
is cooperative and filesystem effects are not rolled back. Byte I/O preserves
raw data, while source text requires valid UTF-8.

This private workspace is bundled into Safe Bash. Use its public exports; no
separate package installation or new `safejs` command registration is required.
