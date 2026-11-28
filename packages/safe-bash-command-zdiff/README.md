# zdiff

Use `zdiff` to compare gzip-compressed or plain files without changing them.

```ts
import { zdiffCommands } from "safe-bash-command-zdiff";
shell.use(zdiffCommands());
```

Accepts the underlying utility options and a cumulative `maxDecodedBytes` limit.
