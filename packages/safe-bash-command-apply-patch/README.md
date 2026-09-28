# apply_patch

Use this command with virtual files and configurable resource limits.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { applyPatchCommands } from "@poe-platform/safe-bash/commands/apply-patch";

const fs = createMemoryFileSystem();

const shell = new Shell({ fs }).use(applyPatchCommands());
const result = await shell.exec("apply_patch <<'PATCH'\n*** Begin Patch\n*** Add File: /hello.txt\n+hello\n*** End Patch\nPATCH");
await shell.dispose();
```

Also available: `createApplyPatchCommand`, `createApplyPatchCommands`, and typed options and limits.
