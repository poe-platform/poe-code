# zfgrep

Use `zfgrep` to search gzip-compressed or plain files without unpacking them.

```ts
import { zfgrepCommands } from "safe-bash-command-zfgrep";
shell.use(zfgrepCommands());
```

Accepts the underlying utility options and a cumulative `maxDecodedBytes` limit.
