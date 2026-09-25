# XZ commands for Safe Bash

Compress and inspect virtual files or stream bytes through `xz`, `unxz`, and
`xzcat`. These commands are included in Safe Bash's existing byte and agent
command collections. A smaller registry can select just this family:

```ts
import { Shell, CommandRegistry, createMemoryFileSystem } from '@poe-platform/safe-bash';
import { createXzCommands } from '@poe-platform/safe-bash/commands/xz';

const commands = new CommandRegistry();
for (const command of createXzCommands()) commands.register(command);
const shell = new Shell({ fs: createMemoryFileSystem(), commands });
try {
  const result = await shell.exec('xz -c | xzcat', { stdin: 'hello' });
  console.log(result.stdout);
} finally {
  await shell.dispose();
}
```

The existing profile supports XZ, legacy LZMA and raw formats; CRC32, CRC64,
SHA-256 and omitted checks; presets, custom filter chains, block controls,
single-stream decoding, custom suffixes, and human or robot index listings.
The codec runs as bundled JavaScript without native processes or runtime fetches.
It is single-threaded: `--threads=1` is supported. Listing requires a retained
virtual-file read handle and does not read stdin.

Pass `maxDecodedBytes` to `createXzCommands` to enforce an optional decoded-byte
quota. Explicit XZ compression and decompression memory limits retain their
existing behavior; setting one quota does not enable the others.
File output requires the existing private staging,
identity and publication capabilities of the virtual filesystem.

This workspace is private and bundled into the existing Safe Bash distribution.
Use the public imports above; no separate package installation is required.
