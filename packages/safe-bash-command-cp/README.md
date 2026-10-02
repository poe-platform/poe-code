# Copy virtual files

Safe Bash provides `cp` for copying files and directory trees between configured virtual filesystems. It supports recursive/archive copies, symbolic and hard links, metadata preservation, interactive overwrite, backups, update and no-clobber policies.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { cpCommands } from "@poe-platform/safe-bash/commands/cp";

const fs = createMemoryFileSystem();
await fs.writeFile("/source", new TextEncoder().encode("hello"));
const shell = new Shell({ fs }).use(cpCommands({
  limits: { maxDirectoryEntries: 1000, maxRecursiveDirectoryDepth: 32 },
}));
await shell.exec("cp /source /copy");
await shell.dispose();
```

`cp` is also included in standard and agent commands. Use `replace: true` to replace an existing registration. Both directory limits default to `Infinity`, preserving standard-command behavior; finite limits reject excessive listings or recursion. Filesystem capabilities must support retained source reads and safe destination publication. Unsupported preservation capabilities fail explicitly.

This private workspace is bundled into Safe Bash. No separate installation is required. It uses only the configured virtual filesystem on Node, browser and workerd profiles.
