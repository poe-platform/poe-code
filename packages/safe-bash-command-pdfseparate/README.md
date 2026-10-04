# pdfseparate

Split a PDF into one file per page, or extract a selected page range.

Available through `@poe-platform/safe-bash/commands/pdfseparate`:

```ts
import { pdfseparateCommands } from "@poe-platform/safe-bash/commands/pdfseparate";
shell.use(pdfseparateCommands());
await shell.exec("pdfseparate -f 2 -l 5 document.pdf page-%03d.pdf");
```

Supports `-v`, `-h`, `-help`, and `--help`. Page numbers are one-based. Multiple pages require an integer destination pattern such as `%d` or `%03d`; `%%` produces a literal percent sign.

Factories: `createPdfseparateCommand`, `createPdfseparateCommands`. Options accept `replace` and `limits`: `maxInputBytes` (64 MiB), `maxOutputBytes` (128 MiB), `maxPages` (10,000), and `maxObjects` (100,000 per input). All I/O uses the shell filesystem; the PDF engine is `@poe-code/pdf-ast`. Input is retained for range reads, and copied pages stream to caller-backed scratch storage before atomic output publication. `TMPDIR` selects the scratch directory. Use an external filesystem backend for large files; memory-backed filesystems keep their stored contents in RAM.
