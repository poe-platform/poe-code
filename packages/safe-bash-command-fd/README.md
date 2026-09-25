# fd for Safe Bash

Find files and directories in your virtual filesystem with regular expressions,
globs, extensions, metadata filters, and directory ignore files. No host process
or implicit host filesystem is used.

```ts
import { Shell, MemoryFileSystem, agentCommands } from '@poe-platform/safe-bash';

const fs = new MemoryFileSystem();
await fs.mkdir('/project/src', { recursive: true });
await fs.writeFile('/project/src/app.ts', new TextEncoder().encode('export {}'));
const shell = new Shell({ fs, cwd: '/project' }).use(agentCommands());
await shell.exec('fd -e ts'); // src/app.ts\n
await shell.dispose();
```

For explicit registration, import `fdCommands` or `createFdCommand` from
`@poe-platform/safe-bash/commands/fd`. This implementation workspace is private and bundled into Safe Bash.

| Task | Example |
| --- | --- |
| Smart-case regex, glob, or literal names | `fd 'test.*'`, `fd -g '*.ts'`, `fd -F 'a.b'` |
| Match absolute paths and multiple patterns | `fd -p src --and test` |
| Select extensions and types | `fd -e ts -e js -t f`, `fd -t d`, `fd -t l`, `fd -t x`, `fd -t e` |
| Exclude paths and bound depth | `fd -E vendor --min-depth 2 -d 4`, `fd --exact-depth 2` |
| Filter size and modification time | `fd -S +1ki --changed-within 1day --changed-before '2100-01-01'` |
| Include hidden or ignored entries | `fd -H`, `fd -I`, `fd -u`, `fd -uu` |
| Control ignore scope and follow links | `fd --no-ignore-vcs --no-ignore-parent -L` |
| Limit or test for matches | `fd -1`, `fd --max-results 10`, `fd -q pattern` |
| Print NUL records, absolute paths, or details | `fd -0`, `fd -a`, `fd -l` |
| Format paths | `fd --format '{//}/{/.}'` |
| Execute registered commands | `fd -e ts -x wc -l '{}' ';'`, `fd -e ts -X wc -l '{}' ';'` |

`-s` forces sensitive matching and `-i` forces insensitive matching. Smart case
considers all required patterns. Extensions are case insensitive. Types can be
repeated; `empty` and `executable` refine the selected types. Sizes use integer
bytes or decimal/binary units (`k`, `kb`, `ki`, `kib`, through tera). Times accept
durations, dates, or Unix seconds prefixed with `@`.

Hidden entries are skipped by default. `.gitignore`, `.ignore`, and `.fdignore`
are read entirely from the supplied VFS, including parent directories unless
`--no-ignore-parent` is set. `.fdignore` overrides `.ignore`, which overrides
`.gitignore`; nested rules override parent rules of the same kind. Negation
cannot reinclude descendants of a pruned directory. Gitignore rules apply even
without a Git repository; no ambient global ignore file or host Git config is read.
`-I` disables all ignore files, `--no-ignore-vcs` disables only `.gitignore`, and
`-u`/`-uu` disable ignores and include hidden entries. Following links detects
ancestor cycles and retains dangling links as symlinks.

Output is deterministic, with `/` appended to directories. `-0` and execution
prefix ordinary relative paths with `./`. `--format` and execution substitute
`{}`, `{/}`, `{//}`, `{.}`, and `{/.}`; doubled braces escape literal braces.
Execution dispatches literal arguments through the Shell registry, sequentially;
batch execution permits one replacement token. Quote the terminating `';'` when
writing shell source. `-l` invokes the registered virtual `ls -ld` command.
Normal empty searches succeed; quiet searches return 1 if no result exists.
Command failures and filesystem errors return a nonzero status.

Traversal, ignore-file reads, and matching have no finite default resource
budgets. The SDK factory accepts explicit `maxEntries`, `maxIgnoreFileBytes`,
`maxRegexSteps`, and `maxRegexBufferBytes` ceilings; exhaustion is an error, never
silent truncation. Regexes use Safe Bash's cooperative text engine; ignore/glob
matching uses its bounded glob engine. Supported regex syntax includes literals, classes,
anchors, groups, alternatives, repetitions, and shorthand classes. This is not
Rust regex syntax certification. Unsupported syntax fails explicitly.
