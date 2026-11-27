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

`date -d '10:20'`, `date -d '10am'`, and `date -d 'today 00:00'` use today's date in the virtual timezone. Times accept `am`/`pm` and `a.m.`/`p.m.`, including after an explicit date.

Month-name dates accept `Jan 5 2024`, `5 Jan 2024`, `5-Jan-2024`, and `January 5, 2024 3pm`. You can also pass the default `date` output back to `date -d`.

Relative dates accept multiple items, attached units, and case-insensitive units: `date -u -d '2024-01-05 +1day +2 hours' +%FT%T` prints `2024-01-06T02:00:00`. Use `sec`, `min`, `hr`, or `fortnight` (including plurals); `ago` negates the item immediately before it.

`date -d` accepts English month names in `Jan 5 2024`, `5 Jan 2024`, `5-Jan-2024`, and `January 5, 2024 3pm`, as well as default UTC output such as `Fri Jan  5 10:20:30 UTC 2024`. Month names are case-insensitive; dates without an explicit zone use the virtual `TZ`. Invalid calendar dates and ambiguous or nonexistent local times remain errors.
