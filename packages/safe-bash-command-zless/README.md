# zless

Use `zless` to read gzip-compressed or plain files.

```ts
import { zlessCommands } from "safe-bash-command-zless";
shell.use(zlessCommands());
```

Accepts the underlying utility options and a cumulative `maxDecodedBytes` limit.
