# PDF text and layout comparison

Find changed document pages without comparing PDF serialization or metadata:

```ts
import { diffpdfCommands } from "@poe-platform/safe-bash/commands/diffpdf";
shell.use(diffpdfCommands());
await shell.exec("diffpdf --text old.pdf new.pdf");
await shell.exec("pdfdiff --layout old.pdf new.pdf");
```

| Option | Behavior |
| --- | --- |
| `--text` (default) | Compare extracted text per page |
| `--layout` | Also compare page geometry, rotation, word bounds and font geometry |
| `--help` | Show command syntax |

Both aliases accept two virtual filesystem paths. Changed pages are reported on
stdout; exit status is 0 for equality, 1 for differences and 2 for invalid input.
Image and arbitrary vector changes are outside text/layout comparison; this is
not a pixel comparison tool.

`createDiffpdfCommand`, `createDiffpdfCommands`, and `diffpdfCommands` accept
`DiffpdfCommandsOptions` (`limits`, `replace`). The plugin registers both aliases.
`DiffpdfLimits` defaults to 32 MiB cumulative input and 1,000 pages per document.
Parsing and page traversal cooperate with cancellation.
