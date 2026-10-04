# diff

Compare files and directories in a virtual filesystem, with byte-preserving
output and explicit resource limits.

- Normal, unified, context, side-by-side, ed, RCS and conditional output.
- Recursive directory comparison, exclusions and ignored-change options.
- Exit status 0 for equal inputs, 1 for differences and 2 for errors.
- Optional input, output, line, work, matrix, file, hunk and exclusion limits.
- Exact `--brief` comparisons of regular files use retained 64 KiB reads,
  including binary files and arbitrarily long lines.
- Normal, unified, context, RCS, conditional, ed and side-by-side output uses
  bounded document, line-index and LCS caches backed by your filesystem, including
  stdin, whitespace/case normalization and display transformations.

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
stream capabilities and does not invoke a host diff process. The bounded brief
path requires identity-checked retained reads from the injected filesystem.
Indexed comparisons stage data and output in bounded page caches. Larger inputs
spill through retained handles in your filesystem under `TMPDIR` (or the working
directory); use external storage for large workloads, since memory filesystems
retain spilled data in RAM. The backend must support positioned reads/writes,
exclusive creation, and conditional removal. Paginated output is staged in caller
storage and emitted in bounded blocks after formatting succeeds.
Ignored-line and function-heading options, directory metadata, special-file
operands, and the pagination formatter still have buffered paths; this is not a general bounded-memory guarantee for every diff option.
