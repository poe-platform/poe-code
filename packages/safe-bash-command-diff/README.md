# diff

Compare files and directories in a virtual filesystem, with byte-preserving
output and explicit resource limits.

- Normal, unified, context, side-by-side, ed, RCS and conditional output.
- Recursive directory comparison, exclusions and ignored-change options.
- Exit status 0 for equal inputs, 1 for differences and 2 for errors.
- Optional input, output, line, work, matrix, file, hunk and exclusion limits.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { diffCommands } from "@poe-platform/safe-bash/commands/diff";

const fs = createMemoryFileSystem();
await fs.writeFile("/before", new TextEncoder().encode("old\n"));
await fs.writeFile("/after", new TextEncoder().encode("new\n"));
const shell = new Shell({ fs }).use(diffCommands({
  maxInputBytes: 1_000_000,
  maxOutputBytes: 1_000_000,
  maxWork: 10_000_000,
}));
try {
  const result = await shell.exec("diff -u /before /after");
  console.log(result.stdout);
} finally {
  await shell.dispose();
}
```

`createDiffCommand()` returns one command; `createDiffCommands()` returns its
command family without registration. `diffCommands({ replace: true })` explicitly
replaces an existing registration. The default plugin rejects collisions.
Omitted quotas remain unbounded; set finite limits for untrusted inputs.

This internal workspace ships inside Safe Bash. Consumers use the public exports
above, without installing a separate diff package. It uses injected filesystem and
stream capabilities and does not invoke a host diff process.
