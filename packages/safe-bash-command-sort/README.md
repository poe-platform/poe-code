# Safe Bash sort

Sort byte records in an injected virtual filesystem, with stable sorting, keys,
numeric and locale modes, duplicate elimination, order checking and merging.

```ts
import { sortCommands } from "safe-bash-command-sort";
shell.use(sortCommands());
```

`createSortCommand`, `createSortCommands` and `sortCommands` expose the same
command options used by `sort` in Safe Bash.

Use `sort -c` / `-C` to check order with one preceding record, `sort -m`
to merge ordered sources, and `sort -u` to suppress equal keys. General sorting
spills sorted runs through the caller's injected safe-fs when its batch fills.
Output preserves input bytes and supports retained output aliases with `-o`.

```ts
shell.use(sortCommands({ limits: {
  memoryBytes: 8 * 1024 * 1024,
  mergeFanIn: 16,
  maxInputBytes: Infinity,
  maxRecords: Infinity,
} }));
```

CLI equivalents are `-S` / `--buffer-size` (bytes, or K/M/G suffix),
`--batch-size`, `--max-input-bytes`, and `--max-records`. CLI settings override
plugin defaults. Memory defaults to 8 MiB (minimum 1 MiB), fan-in to 16
(range 2–32); total input bytes and records are unlimited by default.
The working-memory setting controls batching and page caches, independently of
input admission. It is not a whole-process heap limit.

Records larger than the budget use paged storage, including byte, key, numeric,
human numeric and version comparisons. Spill storage requires caller-authorized
scratch storage and retained positioned I/O. Use an external backend for large
Worker inputs: a memory filesystem still keeps its stored contents in RAM.

Locale ordering preserves the host `Intl.Collator` behavior. Oversized locale
comparisons still materialize whole strings and therefore do **not** have bounded
working memory. Worker memory/CPU qualification remains pending; see the
[manual qualification plan](../../docs/plans/bounded-sort-worker-qa.md).
