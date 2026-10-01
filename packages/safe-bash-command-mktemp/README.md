# mktemp

Run mktemp against a supplied virtual filesystem, with optional metadata and output quotas.

```ts
import { mktempCommands } from "safe-bash-command-mktemp";
shell.use(mktempCommands());
```

`mktemp` and `mktemp -d` create the default `/tmp` in a writable VFS when needed. Explicit `-p`/`TMPDIR` directories must already exist. `-t PREFIX` accepts BSD prefixes and appends ten random characters; GNU templates with an `XXX` run remain supported. Dry runs create nothing. Temporary creation requires VFS permission support and uses exclusive creation with private modes.
