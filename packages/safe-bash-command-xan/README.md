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
(`frequency`), `join`, `dedup`, `enum`, `transpose`, `agg`, `groupby`,
`to`, `from`, `cat`, and `split`. Use `xan --help` for supported options.

```sh
xan sort -s score -N data.csv
xan search -s name alice data.csv
xan filter 'score >= 80' data.csv
xan rename -s score points data.csv
xan drop private_notes data.csv
xan stats -s score data.csv
xan freq -s category data.csv
xan join --left id people.csv id cities.csv
xan dedup -s id data.csv
xan groupby category 'sum(score) as total, count() as n' data.csv
xan to jsonl data.csv -o data.jsonl
xan from -f json data.json
xan cat rows first.csv second.csv
xan split -S 1000 -O chunks data.csv
```

`head` and `tail` default to ten data rows. Search matches literal substrings,
with exact and case-insensitive options. Filters accept named-column comparisons
with string or numeric literals. Stats emits a CSV table of counts, numeric
aggregates, lexical extrema and byte lengths. Joins support composite keys,
duplicate matches, inner/outer/semi/anti/cross modes and explicit key projection.
Matching column names are emitted once by default for inner, left and right joins.
`agg` and `groupby` support `count`, `sum`, `mean`/`avg`, `min`, `max`,
`first` and `last`, with optional `as` aliases. `enum` prepends a row index;
`transpose` exchanges rows and columns. `dedup` supports selected keys and
keeping the last or only repeated keys. `cat rows` stacks files and `cat cols`
combines columns, optionally padding shorter files. `split` writes numbered
CSV files by row count or number of chunks.

`to` exports JSON, JSON Lines (`jsonl`/`ndjson`) or text; JSON numeric columns
are inferred across all rows. `from` imports JSON objects, JSON Lines or UTF-8
text (`txt`/`text`/`lines`, or `raw` for one cell). Use `-f` for stdin; file
inputs infer their format from the extension. Conversions require valid UTF-8.
Advanced expression syntax and unlisted upstream options return diagnostics.

Row transforms stream input; sorting, reversal and the right side of joins retain
rows. Transposition, conversion and splitting also retain input; deduplication
retains distinct keys and rows. Statistics retain column summaries; frequencies
retain distinct values; grouped aggregates retain one summary per distinct key.
Configure `limits` to bound work, retained memory, input and output. Limits default
to unbounded; `maxLastRows` applies to `tail` and `slice --last`.
