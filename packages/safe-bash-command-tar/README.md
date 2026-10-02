# tar

Run `tar` against an injected virtual filesystem with portable byte streams.

```ts
import { createTarCommand, tarCommands } from "@poe-platform/safe-bash/commands/tar";

const command = createTarCommand();
const plugin = tarCommands();
```

Use the command with a `CommandContext`, or install the plugin in a Safe Bash shell. `createTarCommands()` returns the command definitions without registering them. Limits are optional; omitted quotas are unbounded. Set finite limits for untrusted input.

Archive sources can use S3, WebDAV, or custom filesystems without retained read handles. Source checks honor scoped numeric or opaque identities and opaque version tokens, including when acquiring retained read handles. Reads without retained handles verify canonical paths, sizes, timestamps, and available version tokens before and after consumption; they cannot provide a snapshot against concurrent changes. Existing-archive replacement still requires backing identity.

`--exclude=dir/` and `--exclude=./file` normalize slash spelling. File lists resolve relative to the active `-C` directory; `--null` and `--verbatim-files-from` may follow `-T` when no earlier decoding mode was specified.
