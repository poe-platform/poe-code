# Shared line-ending conversion

Safe Bash uses one engine for DOS/Unix conversion, BOM and UTF-16 detection,
binary-file checks, shared option handling, synchronous evaluation, file information,
bounded byte streams and staged VFS
publication. Sharing these rules keeps both conversion directions consistent.

The engine is private and bundled into Safe Bash. Access conversion through the
established public API:

```ts
import { createDos2unixCommand, createUnix2dosCommand } from "@poe-platform/safe-bash/commands/line-endings";

const commands = [
  createDos2unixCommand({ limits: { maxInputBytes: 1024 * 1024 } }),
  createUnix2dosCommand({ limits: { maxInputBytes: 1024 * 1024 } }),
];
```

The engine adds no external runtime dependencies. It uses the supplied VFS,
byte streams, cancellation signal and canonical Safe Bash runtime contracts.
Limits and supported Node/browser/workerd profiles remain those of the public
Safe Bash entrypoints.
