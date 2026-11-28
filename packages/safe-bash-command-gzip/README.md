# gzip

Run `gzip` against an injected virtual filesystem with portable byte streams.

```ts
import { createGzipCommand, gzipCommands } from "@poe-platform/safe-bash/commands/gzip";

const command = createGzipCommand();
const plugin = gzipCommands();
```

Use the command with a `CommandContext`, or install the plugin in a Safe Bash shell. `createGzipCommands()` returns the command definitions without registering them. Limits are optional; omitted quotas are unbounded. Set finite limits for untrusted input.

The plugin registers `gzip`, `gunzip`, and `zcat`; `maxDecodedBytes` bounds decompression. Decoding and integrity testing also accept Unix compress (`.Z`) streams and single-member deflated ZIP input. Named compression skips files that already have a compressed suffix, prints a warning, and succeeds; `-q` hides the warning and `-f` permits compressing them again.

Use `gzip -l file.gz` or `gzip --list file.gz` to show compressed and uncompressed sizes, compression ratio, and the uncompressed filename without extracting or changing files. Listing accepts stdin and multiple files; `-q` hides the heading and totals. Like GNU gzip, the uncompressed size comes from the last member's 32-bit trailer; use `gzip -t` to validate compressed data.
