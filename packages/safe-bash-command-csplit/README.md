# csplit

Split virtual files at line numbers or basic regular-expression boundaries,
with repeated sections, custom output names and optional resource limits.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { csplitCommands } from "@poe-platform/safe-bash/commands/csplit";

const fs = createMemoryFileSystem();
const shell = new Shell({ fs }).use(csplitCommands({ limits: { maxFiles: 16 } }));
try {
  await shell.exec("csplit -f part - 2", { stdin: "first\nsecond\nthird\n" });
  // /part00 contains first\n; /part01 contains second\nthird\n.
} finally {
  await shell.dispose();
}
```

Use `/REGEXP/[OFFSET]` to split at a match, `%REGEXP%[OFFSET]` to discard a
section, and `{N}` or `{*}` to repeat a pattern. `--suppress-matched` omits
boundary lines; `-z` elides empty outputs; `-s` suppresses byte counts.
`-f`, `-n` and `-b` control prefixes, digits and suffix formats. `-k` keeps
created outputs when splitting fails; otherwise the command cleans them up.

The supplied filesystem must support atomic file mutation. Node and portable
browser/workerd exports use the same virtual filesystem contract; commands do
not access host files. Regex execution uses the bounded engine or an explicitly
injected `regexExecutor` provider.

`CsplitCommandsOptions.limits` accepts independent file, byte, line, pattern,
path, work and regex budgets. Omitted limits remain unlimited; set limits for
untrusted workloads. The public module also exports `createCsplitCommand`,
`createCsplitCommands`, `CsplitCommandsOptions` and `CsplitLimits`. Registration
rejects an existing `csplit` unless `replace: true` is supplied.

This implementation is bundled into Safe Bash. Consumers use the public imports
above; there is no separate command package to install.
