# basenc

Run `basenc` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { basencCommands } from "@poe-platform/safe-bash/commands/basenc";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(basencCommands());
const result = await shell.exec("printf hello | basenc --base64url");
```

The module also exports `createBasencCommand`, its command-list factory, and typed options and limits.

Select `--base64`, `--base64url`, `--base32`, `--base32hex`, `--base16`, `--base2msbf`, `--base2lsbf`, or `--z85`. Use `-d` to decode, `-i` to ignore non-alphabet characters, and `-w0` to disable the default 76-column wrapping. Z85 encoding requires a multiple of four input bytes. Set `limits.maxInputBytes` to bound input consumption.
