# find

Select files modified after a date with `find . -type f -newermt '2020-06-01'`.
`-newerXY` compares access (`a`), change (`c`), modification (`m`), or birth (`B`)
times; `-anewer` and `-cnewer` compare access and change times against a reference
file’s modification time. `-atime`, `-ctime`, and `-mtime` select by age in days,
with `+n` for older and `-n` for newer. `Y=t` accepts a date instead of a reference file. Dates use `TZ`, defaulting
to UTC, and support explicit offsets, `@` epoch seconds, and relative dates such
as `1 day ago`. Comparisons are strictly newer. Missing candidate birth times do
not match; missing reference birth times report an error before any actions run.
`-anewer FILE` and `-cnewer FILE` compare access or change time to FILE's modification
time. `-atime`, `-ctime`, and `-mtime` select by age in days; use `-amin`, `-cmin`,
and `-mmin` for minutes. Prefix the age with `+` for older or `-` for newer files.

Run `find` against an injected virtual filesystem with portable byte streams. `-executable`, `-readable`, and `-writable` test filesystem access, including symlink targets and read-only policies.

```ts
import { createFindCommand, findCommands } from "@poe-platform/safe-bash/commands/find";

const command = createFindCommand();
const plugin = findCommands();
```

Use the command with a `CommandContext`, or install the plugin in a Safe Bash shell. `createFindCommands()` returns the command definitions without registering them. Limits are optional; omitted quotas are unbounded. Set finite limits for untrusted input.

`find -exec` and `-execdir` use the context’s `invoke` capability, or an explicit `execute` handler. They never start host processes. `-execdir` runs in each match’s directory with `./name` arguments; `+` batches stay within one directory. `limits.maxDirectoryEntries` bounds directory admission.

Use `find . -regextype posix-extended -regex '.*/(src|test)'` to match whole paths with alternation, or `-iregex` for case-insensitive matching. `posix-extended` is the supported explicit regex type; other type names are rejected.
