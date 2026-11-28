# zegrep

Use `zegrep` to search gzip-compressed or plain files without unpacking them.

```ts
import { zegrepCommands } from "safe-bash-command-zegrep";
shell.use(zegrepCommands());
```

Accepts the underlying utility options and a cumulative `maxDecodedBytes` limit.
