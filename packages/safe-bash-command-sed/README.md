# sed

Run `sed` against an injected virtual filesystem with portable byte streams. Regular expressions count UTF-8 characters by default and in UTF-8 locales; C/POSIX locales retain byte matching. Substitution replacements support whole-match and numbered captures, plus GNU case conversion with `\U`, `\L`, `\u`, `\l`, and `\E`.

```ts
import { createSedCommand, sedCommands } from "@poe-platform/safe-bash/commands/sed";

const command = createSedCommand();
const plugin = sedCommands();
```

Use the command with a `CommandContext`, or install the plugin in a Safe Bash shell. `createSedCommands()` returns the command definitions without registering them. Limits are optional; omitted quotas are unbounded. Set finite limits for untrusted input.

Supported operations include addressed substitutions, print/delete, hold space,
branches, program files (`-f`), extended regular expressions (`-E`), null-delimited
records (`-z`), and in-place edits with optional backups (`-i.bak`). In-place
editing requires filesystem support for confined, conditional publication.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { sedCommands } from "@poe-platform/safe-bash/commands/sed";

const shell = new Shell({ fs: createMemoryFileSystem() }).use(sedCommands({
  maxProgramInstructions: 100,
  maxSteps: 100_000,
  maxBufferBytes: 1024 * 1024,
}));
try {
  const result = await shell.exec("sed 's/old/new/g'", { stdin: "old text\n" });
  console.log(result.stdout); // new text
} finally {
  await shell.dispose();
}
```

The default `agentCommands()` already includes sed. Use `replace: true` when
installing a configured sed plugin over that default registration. This internal
workspace ships through Safe Bash; no separate installation is needed.
