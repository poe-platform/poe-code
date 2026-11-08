# chmod

Run chmod against a supplied virtual filesystem, with optional metadata and output quotas.

```ts
import { chmodCommands } from "safe-bash-command-chmod";
shell.use(chmodCommands());
```

Leading-minus modes such as `-r`, `-wx`, and `-002` remove permissions. Use `--reference=FILE` to copy permissions. Recursive changes protect the virtual root by default; `--preserve-root` explicitly enables that protection and `--no-preserve-root` disables it. The last root option wins, and filesystem permissions and traversal quotas still apply.
