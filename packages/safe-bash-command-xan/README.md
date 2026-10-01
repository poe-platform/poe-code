# xan

Run `xan` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { xanCommands } from "@poe-platform/safe-bash/commands/xan";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(xanCommands());
const result = await shell.exec("xan --help");
```

The module also exports `createXanCommand`, its command-list factory, and typed options and limits.

Available commands: `headers` (`h`), `count`, `select`, `slice`, `head`, `tail`,
`sort`, `search`, `filter`, `reverse`, `rename`, `drop`, `stats`, `freq`
(`frequency`), and `join`. Use `xan --help` for supported options.

```sh
xan sort -s score -N data.csv
xan search -s name alice data.csv
xan filter 'score >= 80' data.csv
xan rename -s score points data.csv
xan drop private_notes data.csv
xan stats -s score data.csv
xan freq -s category data.csv
xan join --left id people.csv id cities.csv
```

`head` and `tail` default to ten data rows. Search matches literal substrings,
with exact and case-insensitive options. Filters accept named-column comparisons
with string or numeric literals. Stats emits a CSV table of counts, numeric
aggregates, lexical extrema and byte lengths. Joins support composite keys,
duplicate matches, inner/outer/semi/anti/cross modes and explicit key projection.
Matching column names are emitted once by default for inner, left and right joins.
Advanced expression syntax and unlisted upstream options return diagnostics.

Row transforms stream input; sorting, reversal and the right side of joins retain
rows. Statistics retain column summaries; frequencies retain distinct values.
Configure `limits` to bound work, retained memory, input and output. Limits default
to unbounded; `maxLastRows` applies to `tail` and `slice --last`.
