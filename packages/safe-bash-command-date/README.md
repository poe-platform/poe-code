# date

Run `date` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { dateCommands } from "@poe-platform/safe-bash/commands/date";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(dateCommands());
const result = await shell.exec("date --help");
```

The module also exports `createDateCommand`, its command-list factory, and typed options and limits.

`date -u -r 1700000000 +%F` accepts epoch seconds when the numeric reference file does not exist; existing files take priority and `--reference` remains file-only. Signed and fractional epochs are supported. Use ordered `-v[+|-]VALUE[ymwdHMS]` adjustments to add/subtract units or set calendar fields; month/year changes clamp to the last valid day. `-j` accepts BSD read-only invocations without setting a clock. GNU `-f` continues to read dates from a file. BSD calendar adjustments advance across skipped local times and choose the first occurrence of repeated local times; GNU date parsing retains its strict timezone validation.
