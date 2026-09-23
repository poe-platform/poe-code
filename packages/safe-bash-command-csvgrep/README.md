# csvgrep

Filter CSV rows in a virtual filesystem or pipeline without installing a native tool. Empty input produces a single LF when filtering (including headerless mode); `--names` fails with status 1 and a concise diagnostic when no header is available.

```ts
import { Shell } from '@poe-platform/safe-bash';
import { MemoryFileSystem } from '@poe-platform/safe-fs/core';
import { csvgrepCommands, csvgrep } from '@poe-platform/safe-bash/commands/csvgrep';

const fs = new MemoryFileSystem();
await fs.writeFile('/input.csv', new TextEncoder().encode('name,city\nAlice,York\n'));
const shell = new Shell({ fs }).use(csvgrepCommands());
try {
  console.log(await shell.exec('csvgrep -c city -m York /input.csv'));
} finally {
  await shell.dispose();
}
// Inside a command handler with the supplied context:
await csvgrep(context, { columns: 'name,city', match: 'York', any: true });
```

| Option | Behavior |
| --- | --- |
| `-c`, `--columns` | Ordered positions, exact names or closed inclusive ranges; numeric selectors are positions. |
| `-m`, `--match` | Substring search of decoded selected cells. Empty patterns are omitted. |
| `-f`, `--file` | Exact membership in a UTF-8-sig VFS file; each physical line loses all Python Unicode trailing whitespace. |
| `-r`, `--regex` | Bounded Python search subset described below. Truthy regex wins over file, which wins over substring. |
| `-a`, `--any-match` | Any selected cell instead of all. |
| `-i`, `--invert-match` | Negate the aggregate result. |
| `-H`, `--no-header-row` | Generate headers a..z, aa, bb, cc. |
| `-l`, `--linenumbers` | Prepend `line_numbers`; physical parser line number minus one for a header, before filtering. |
| `-K`, `--skip-lines` | Skip a nonnegative number of physical input lines. |
| `--zero` | Use zero-based column positions and names output. |
| `-n`, `--names` | Print `position: name` lines with positions right-aligned to width three and stop after the header; requires a header row. |
| `-d`, `--delimiter`; `-t`, `--tabs` | Input delimiter; tabs override delimiter. Default comma; no sniffing. |
| `-q`, `--quotechar`; `-p`, `--escapechar` | Single UTF-16-unit quote/escape characters; default quote is `"`, escape unset. |
| `-b`, `--no-doublequote`; `-S`, `--skipinitialspace` | Disable doubled quotes; skip initial ASCII spaces. |
| `-u`, `--quoting` | Input quoting 0 (default) or 3; modes 1/2 fail explicitly. |
| `-e`, `--encoding` | Only `utf-8-sig` / `utf8-sig` (case-insensitive); never inherits host encoding. |

Short flags may be grouped (`-ai`) and short-option values attached (`-cx,y`, `-ma`). Use `--` before a literal path beginning with a dash. The SDK uses `columns`, `match`, `file`, `regex`, `any`, `invert`, `headerless`, `lineNumbers`, `zero`, `names` and `filePath`; input settings live in `dialect` (`delimiter`, `tabs`, `quote`, `escape`, `doubleQuote`, `skipInitialSpace`, `quoting`, `skipLines`). Decoding is always UTF-8-sig.

Accepts one optional CSV path; omission or `-` reads stdin. `-f -` also reads stdin. Long value options accept `--option=value`. There is no `--help`/`--version` flag. `-z`/`--maxfieldsize` is recognized but rejected: configure `fieldBytes` instead. No selector-name trimming or open ranges.

```sh
csvgrep -c name -m Alice /input.csv
csvgrep -c city -f /allowed-cities.txt /input.csv
csvgrep -c 1 --regex='(?i)^alice$' -l /input.csv
csvgrep -n /input.csv
```

Rows retain their cell order and width, including short rows; missing selected fields match as empty strings. Headers always appear when there are no matches. Output uses comma and LF, with each embedded CR converted to LF. Invalid patterns return status 1, argument errors 2, no matches 0. I/O uses only the supplied filesystem and byte streams.

Regex profile `bounded-sequence-v1` supports literals, escaped punctuation, dot, character classes/ranges/negation, Unicode-13 decimal digits (`\d`/`\D`), Python whitespace (`\s`/`\S`), `^`, `$`, `\A`, `\Z`, and initial global `(?a)`, `(?i)`, `(?m)`, `(?s)`, `(?u)` combinations. `u` explicitly selects the default Unicode behavior; combining `a` and `u` is an invalid pattern. ASCII ignore-case literals and letter ranges with same-case endpoints also recognize Python's İ, ı, ſ and K in Unicode mode. Non-ASCII ignore-case patterns, mixed-case/nonletter ignore-case ranges, groups, alternation, repetition, captures/references, assertions, word categories, verbose/scoped flags and later Python grammar fail explicitly before output. Patterns never run through JavaScript RegExp or a host engine. Search charges every candidate and atom; there are no workers, queues, recursion or global caches.

Configure invocation limits with `csvgrepCommands({ limits })` or the SDK's third argument. Input, decoded UTF-16 storage, output, scanned cells, pattern bytes, set entries/storage, arguments, parser cells and work have separate limits. Retention is a conservative cumulative allocation ledger: freed intermediates do not restore credit during an invocation. Cleanup resets live retention; peak remains available in SDK accounting. Wide fields therefore cost more than their final size. CSV and match-file input share an invocation budget. Writes await backpressure; cancellation propagates to VFS acquisition/read/write and closes acquired iterators.

| Limit key | Default |
| --- | ---: |
| `inputBytes` | 16 MiB |
| `decodedBytes`, `outputBytes` | 32 MiB each |
| `retainedBytes` | 64 MiB |
| `fieldBytes`, `setBytes` | 1 MiB each |
| `argumentBytes` | 64 KiB |
| `patternBytes` | 4,096 bytes |
| `cells`, `scannedCells` | 100,000 each |
| `setEntries` | 10,000 |
| `work` | 16,777,216 units |

Limits are nonnegative safe integers; MiB/KiB use powers of 1024. Decoded, field and set text storage uses UTF-16 bytes. SDK returns `{ exitCode, accounting }`; output goes to context sinks, and accounting includes `peakRetainedBytes`. Cancellation rejects with the caller's abort reason. Paths resolve through the supplied VFS and cwd: confinement is the VFS provider's responsibility, not a separate command root.

Other codecs, quoting 1/2, compressed inputs, native field-size units, open selector ranges and additional csvkit shortcuts are explicitly unsupported. Full csvkit compatibility remains open in `docs/plans/safe-bash-csvgrep-acceptance.md`.

CSV profile `utf8-sig-permissive-v1` accepts unclosed quoted EOF and text after a closing quote; trailing escape at EOF inserts LF. Invalid/truncated UTF-8 fails. NUL is retained, a documented deviation from csvkit file iteration. Blank records are empty rows; embedded CRLF becomes two LF on output. This is an explicit subset of csvkit 2.2.0 / agate 1.14.2 on Python 3.9, not full compatibility with those releases or later pinned source additions.

Diagnostics share the invocation's work, retention and output quotas. If a diagnostic cannot fit, the command still returns failure with no diagnostic; it does not bypass quotas. Streamed output can remain partial after failure or cancellation. Shell redirects open before CSV reads: redirecting to the source or a symlink alias truncates the source. This API provides no atomic replacement or exclusive publication guarantee. Use a separate destination and check success before subsequent publication.

This private workspace is bundled with its declarations inside safe-bash. Consumers import the public safe-bash subpath; this workspace is not published.

Runtime: TypeScript ESM, Node.js >=22, byte streams and explicit VFS capabilities; no external command runtime dependencies, host executables/files, implicit network, native/WASM fallback or downloaded dependencies. Browser/workerd export-condition checks qualify the packed graph only; actual engine qualification is separate.
