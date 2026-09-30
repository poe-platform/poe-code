# docx commands

Run Word document operations in a virtual filesystem using an explicitly supplied document engine.

```ts
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";

shell.use(docxCommands({ engine }));
```

The engine receives invocation arguments and cancellation signals. File access and output stay within the virtual shell.

Set `limits.maxArgumentBytes` to bound the bytes admitted before the engine runs. The engine controls document input and output budgets. Both single-command and command-list factories are available for custom registration.
