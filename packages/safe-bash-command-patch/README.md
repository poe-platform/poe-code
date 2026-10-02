# patch

Run `patch` against an injected virtual filesystem with portable byte streams.

```ts
import { createPatchCommand, patchCommands } from "@poe-platform/safe-bash/commands/patch";

const command = createPatchCommand();
const plugin = patchCommands();
```

Use the command with a `CommandContext`, or install the plugin in a Safe Bash shell. `createPatchCommands()` returns the command definitions without registering them. Limits are optional; omitted quotas are unbounded. Set finite limits for untrusted input.

Memory and supported overlays use atomic ancestry-checked publication. RealFileSystem and mounted RealFileSystem use best-effort trusted staging: `patch -i change.diff` and `diff -u old new | patch` work when the host excludes concurrent external writers. Patch checks observed ancestor identities and the destination snapshot before replacement, preserves file modes, and cleans owned staging when its recorded paths remain valid. These checks are not atomic against other host processes; concurrent writers can cause stale overwrites or ancestry escapes. Cleanup refuses changed staging paths rather than following moved or substituted ancestors. Adapters without either publication contract still refuse mutation; `--dry-run` remains available.
