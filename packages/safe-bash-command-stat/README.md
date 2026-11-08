# stat

Run stat against a supplied virtual filesystem, with optional metadata and output quotas.

```ts
import { statCommands } from "safe-bash-command-stat";
shell.use(statCommands());
```

Use `stat -f "%z %N" FILE` for BSD size/name formatting. BSD formats also include `%m`, `%a`, `%c`, `%B`, `%Lp`, `%Sp`, `%u`, `%Su`, `%g`, `%Sg`, `%i`, `%l`, `%HT`, and `%Y`. A `-f` argument containing `%` followed by a path selects BSD formatting; otherwise `-f` retains GNU filesystem behavior. GNU `-c`/`--printf` formats are unchanged.
