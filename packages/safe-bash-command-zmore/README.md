# zmore

Use `zmore` to read gzip-compressed or plain files.

```ts
import { zmoreCommands } from "safe-bash-command-zmore";
shell.use(zmoreCommands());
```

Accepts the underlying utility options and a cumulative `maxDecodedBytes` limit.
