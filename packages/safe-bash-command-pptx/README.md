# pptx commands

Run PowerPoint document operations in a virtual filesystem using a built-in document engine.

```ts
import { pptxCommands } from "@poe-platform/safe-bash/commands/pptx";

shell.use(pptxCommands());
```

The engine receives invocation arguments and cancellation signals. File access and output stay within the virtual shell.

Set `limits.maxArgumentBytes` to bound the bytes admitted before the engine runs. The engine controls document input and output budgets. Both single-command and command-list factories are available for custom registration.

Pass `engine` to use a custom document engine.
