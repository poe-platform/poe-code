# Word comparison

Compare prose without treating every changed line as a replacement:

```ts
import { wdiffCommands } from "@poe-platform/safe-bash/commands/wdiff";
shell.use(wdiffCommands());
await shell.exec("wdiff old.txt new.txt");
// The [-old-] {+new+} contract.
```

`wdiff OLD NEW` accepts virtual filesystem paths and one `-` stdin operand.
Words are separated by ASCII whitespace; bytes are preserved. Exit status is
0 for equal words and 1 for differences. Whitespace alone is not a difference.
Use `--` before filenames beginning with a dash.

`createWdiffCommand`, `createWdiffCommands`, and `wdiffCommands` accept
`WdiffCommandsOptions`: `replace` and `limits`. `WdiffLimits` defaults to
8 MiB cumulative input and 4,000,000 comparison matrix cells. Processing yields
for cancellation. This initial command supports the basic comparison syntax;
GNU formatting and statistics flags are not implemented.
