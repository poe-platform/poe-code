# Grep for Safe Bash

Search virtual files and pipelines with basic, extended, or fixed patterns,
recursive include/exclude selection, context lines, and explicit resource limits.
The existing `egrep` and `fgrep` commands select extended and fixed matching.

```ts
import { Shell, agentCommands, createMemoryFileSystem } from "@poe-platform/safe-bash";

const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
try {
  const result = await shell.exec("printf 'alpha\\nbeta\\n' | grep -n alpha");
  console.log(result.stdout); // 1:alpha
} finally {
  await shell.dispose();
}
```

This private workspace is bundled into Safe Bash. Consumers install and import
only the public Safe Bash package; no separate grep package is required.
