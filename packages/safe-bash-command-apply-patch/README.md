# apply_patch

Use this command with virtual files and configurable resource limits. Patch envelopes may have surrounding whitespace. Context matching prefers exact lines, then retries with trailing whitespace removed, both ends trimmed, and Unicode punctuation normalized. Unchanged context retains its original bytes.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { applyPatchCommands } from "@poe-platform/safe-bash/commands/apply-patch";

const fs = createMemoryFileSystem();

const shell = new Shell({ fs }).use(applyPatchCommands());
const result = await shell.exec("apply_patch <<'PATCH'\n*** Begin Patch\n*** Add File: /hello.txt\n+hello\n*** End Patch\nPATCH");
await shell.dispose();
```

Also available: `createApplyPatchCommand`, `createApplyPatchCommands`, and typed options and limits.

`limits.maxLines` counts patch input lines plus tokenized target lines; copying
those records into the result does not count them again. `maxHunks` counts each
update hunk once, including hunks with context anchors. Host
`capabilities.commandLimits.applyPatch` limits can further restrict configured
limits. Shell input limits include the patch and physical target reads, including
the safety rechecks before publication.

Patch payloads, target snapshots, line indexes and replacements use bounded caches
backed by your injected filesystem. Documents and the success summary share a
256 KiB resident-page budget across all files. Long patch and target lines are matched and copied in blocks, including
whitespace and Unicode normalization. Publication uses retained staging writes and
atomic conditional replacement, preserving existing file identity and hardlinks.
Backends need retained reads, retained staging cleanup/writes, atomic staged file
mutation and confined mutations. Large workloads need external backing storage;
a memory filesystem keeps spilled data in RAM. Line, anchor and hunk descriptors
share a bounded page cache; matching replays them without collecting a pattern
array. File paths and per-file planning metadata still buffer in memory, so this
is not yet a complete bounded-memory guarantee for arbitrary file counts.
