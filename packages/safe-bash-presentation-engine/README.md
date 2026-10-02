# Presentation operations

Shared PowerPoint package inspection, editing and byte transport for document
commands and conversion. This internal engine is bundled into the existing
Safe Bash package; it is not installed separately.

```ts
import { pptxCommands } from "@poe-platform/safe-bash/commands/pptx";

shell.use(pptxCommands());
```

The command supports an injected engine, cancellation and explicit argument
limits. Document operations preserve the existing presentation, OPC and byte
contracts. Shared resource limits remain unlimited unless explicitly configured;
external links are never fetched implicitly.
