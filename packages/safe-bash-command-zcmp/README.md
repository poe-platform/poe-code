# zcmp

Use `zcmp` to compare gzip-compressed or plain files without changing them.

```ts
import { zcmpCommands } from "safe-bash-command-zcmp";
shell.use(zcmpCommands());
```

Accepts the underlying utility options and a cumulative `maxDecodedBytes` limit.
