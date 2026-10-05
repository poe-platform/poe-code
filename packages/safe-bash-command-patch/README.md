# patch

Run `patch` against an injected virtual filesystem with portable byte streams.

```ts
import { createPatchCommand, patchCommands } from "@poe-platform/safe-bash/commands/patch";

const command = createPatchCommand();
const plugin = patchCommands();
```

Use the command with a `CommandContext`, or install the plugin in a Safe Bash shell. `createPatchCommands()` returns the command definitions without registering them. Limits are optional; omitted quotas are unbounded. Set finite limits for untrusted input.

Patch input, target documents, rendered rejects and staged status messages share a 256 KiB
page cache across all files and spill through the caller's filesystem. Status
output uses awaited blocks of at most 16 KiB, preserving atomic-mode timing.
Hunk matching uses stored line indexes; merge and conditional output replay ranges
without copying complete line lists.
Streaming patch input is staged before parsing; mail and CRLF envelopes replay
indexed physical lines. Named inputs and existing targets require identity-checked retained reads.
Normal/context conversion streams into caller storage before parsing.
Context halves replay their stored physical ranges instead of collecting lines.
Parsed hunk bodies, individual decoded lines, per-file metadata and retained resource
handles still grow with the request; this is not a complete memory bound.

Memory and supported overlays use atomic ancestry-checked publication. RealFileSystem and mounted RealFileSystem use best-effort trusted staging: `patch -i change.diff` and `diff -u old new | patch` work when the host excludes concurrent external writers. Patch checks observed ancestor identities and the destination snapshot before replacement, preserves file modes, and cleans owned staging when its recorded paths remain valid. These checks are not atomic against other host processes; concurrent writers can cause stale overwrites or ancestry escapes. Cleanup refuses changed staging paths rather than following moved or substituted ancestors. Adapters without either publication contract still refuse mutation. Dry runs require retained reads for named inputs and targets; piping the diff does not remove the target-read requirement.
