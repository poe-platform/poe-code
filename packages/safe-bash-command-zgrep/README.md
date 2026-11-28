# zgrep

Use `zgrep` to search gzip-compressed or plain files without unpacking them.

```ts
import { zgrepCommands } from "safe-bash-command-zgrep";
shell.use(zgrepCommands());
```

Accepts the underlying utility options and a cumulative `maxDecodedBytes` limit.
