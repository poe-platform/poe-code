# CSV column projection

Select, reorder and repeat CSV columns, list headers, or remove empty projected
rows using bounded byte streams and literal VFS paths. Import the bundled API
from `@poe-platform/safe-bash/commands/csvcut`; this private workspace is never
installed separately. TypeScript ESM, with no external runtime dependencies,
host executables, ambient files/environment, network, native/WASM fallback or
dynamic downloads.

Packed Node ESM imports and declarations are verified. Browser/workerd export
conditions and browser bundles pass isolated graph/VM checks; execution in actual
browser/workerd engines and checkpoint/replay execution remain unqualified.

```ts
import { Shell, agentCommands, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { csvcutCommands } from "@poe-platform/safe-bash/commands/csvcut";

const shell = new Shell({ fs: createMemoryFileSystem() })
  .use(agentCommands()).use(csvcutCommands());
try {
  const result = await shell.exec("printf 'a,b\\nx,y\\n' | csvcut -c2,1,2");
  console.log(result.stdout); // b,a,b\ny,x,y\n
} finally { await shell.dispose(); }
```

Other commands: `csvcut -n /data.csv` lists headers;
`csvcut -xcname -- /data.csv` keeps nonempty projected names.
`csvcut --version` prints `csvcut 2.2.0 (utf8-sig-permissive-v1 candidate)`
with a trailing LF; this identifies the compatibility target and reader profile.
Registration is opt-in; `csvcutCommands({ limits?, replace? })` configures quotas
and explicit replacement. `csvcutCommand` and `createCsvcutCommand({ limits? })`
expose command definitions. Typed `csvcut(context, invocation, { limits? })`
uses the same implementation as CLI argv and returns `{ exitCode }`.

| Supported flag | SDK invocation / behavior |
| --- | --- |
| `-c`, `--columns VALUE` | `include`: ordered comma-separated names/positions/ranges |
| `-C`, `--not-columns VALUE` | `exclude`: remove all occurrences; unknown individual columns ignored, invalid ranges fail |
| `--zero` | `zero`: zero-origin selectors and names display |
| `-x`, `--delete-empty-rows` | `deleteEmptyRows`: drop only all-empty projected data rows; spaces and `0` survive |
| `-n`, `--names` | `names`: width-three positions, colon and raw header; bypass selectors, stop after header |
| `-H`, `--no-header-row` | `headerless`: generate `a..z, aa, bb, cc, …`; incompatible with names mode |
| `-l`, `--linenumbers` | `lineNumbers`: prepend `line_number` header and emitted-record numbers starting at 1 |
| `--add-bom` | `addBom`: prefix UTF-8 BOM, including names mode |
| `-d`, `--delimiter VALUE` | `dialect.delimiter`: one Unicode scalar, default comma |
| `-t`, `--tabs` | `dialect.tabs`: tab overrides delimiter regardless of order |
| `-q`, `--quotechar VALUE` | `dialect.quote`: one Unicode scalar, default double quote |
| `-p`, `--escapechar VALUE` | `dialect.escape`: one Unicode scalar, default none |
| `-b`, `--no-doublequote` | `dialect.doubleQuote: false` |
| `-S`, `--skipinitialspace` | `dialect.skipInitialSpace`: skip ASCII spaces at field start |
| `-K`, `--skip-lines INTEGER` | `dialect.skipLines`: skip physical lines; negative counts skip nothing |
| `-u`, `--quoting INTEGER` | `dialect.quoting`: 0 MINIMAL or 3 NONE; final 1/2 explicitly unsupported |
| `-e`, `--encoding VALUE` | `encoding`: only case-insensitive `utf-8-sig` / `utf8-sig` |
| `-h`, `--help`; `-V`, `--version` | `help`, `version`: informational output without input acquisition |
| `--` | End options; one literal operand maps to `filePath`; omitted operand or `-` reads stdin |

Short flags group, value-taking short flags accept attached values, and long
values accept `=`. Repeated values use the last occurrence. Integer options
accept signed ASCII digits, ASCII surrounding whitespace and single underscores
between digits. Selectors are not trimmed: numeric selectors are positions even
with numeric-looking headers; first duplicate header wins; exact nonnumeric
names precede ranges. Selector numbers accept ASCII surrounding whitespace and
signs; Unicode integer syntax is unqualified. Empty inclusion selects all.
Inclusive `:`/`-` ranges give colon precedence; descending ranges select nothing.
The `csvkit-2.2.0-ascii-v1` candidate retains release quirks: omitted start is
literal 1, omitted end is header count for inclusion or header count minus 1
for exclusion, before origin conversion. Thus zero-origin open-end inclusion
can fail rather than being normalized. Dialect characters exclude CR, LF and NUL.

Output is UTF-8 comma/minimal-double-quote CSV with LF, regardless of input
dialect. Each embedded CR becomes LF, so CRLF in a cell becomes two LF.
Short rows pad selected cells with empty strings; excess cells are discarded.
Zero selected columns emit one LF per record (data rows disappear with `-x`).
Ordinary empty input emits LF; selectors are ignored when the header has zero
columns. Empty names input fails. No inference, locale or
null conversion occurs. Unlike csvgrep physical numbering, `-l` counts emitted
records after deletion.

| Default quota | Value |
| --- | --- |
| `inputBytes` / `decodedBytes` / `retainedBytes` / `outputBytes` | 16 / 32 / 64 / 32 MiB |
| `fieldBytes` / `argumentBytes` | 1 MiB / 64 KiB |
| `work` | 16,777,216 charged units |
| `cells` / `scannedCells` | 100,000 each |
| Shared-engine `patternBytes` / `setEntries` / `setBytes` | 4 KiB / 10,000 / 1 MiB |

Override with `limits: Partial<CsvLimits>`; values must be nonnegative safe
integers. Decoded/field text counts UTF-16 storage; retention/work conservatively
charge intermediates without credit reuse, rather than measuring JS heap.
Input/output count actual byte lengths; arguments reserve up to three bytes per
UTF-16 unit. Shared matching/set quotas are not csvcut CLI options.

`cutCsv(source, invocation, { signal, limits?, registerCleanup? })` yields owned
`Uint8Array` records; `parseCsvRecords(source, { signal, dialect?, limits? })`
yields `{ cells, line }` with physical parser positions.
`source` is a signal-aware byte-source callback; chunks accept cross-realm
Uint8Array/Node Buffer, not other typed-array elements. `CsvParser`, `CsvBudget`,
`resolveColumns`, `generatedHeaders` and `serializeRow` expose the shared engine.
`serializeRow` returns text; callers must charge encoded output before transport.
Low-level callers own parser/budget disposal; disposed state cannot be reused.

```ts
import { cutCsv } from "@poe-platform/safe-bash/commands/csvcut";
const signal = new AbortController().signal;
const source = async function* (signal: AbortSignal) {
  signal.throwIfAborted();
  yield new TextEncoder().encode("a,b\nx,y\n");
};
for await (const bytes of cutCsv(source, { include: "2" }, { signal })) {
  console.log(new TextDecoder().decode(bytes)); // b\n, then y\n
}
```

Projection defaults to `utf8-sig-permissive-v1`; record parsing defaults to
`utf8-sig-strict-v1`, which rejects malformed quote closure, unfinished escapes,
NUL and invalid UTF-8. Both use fatal UTF-8 decoding and strip an initial BOM.
Permissive-v1 accepts NUL and unfinished quoted EOF: it is a candidate profile,
**not full Python 3.9 CSV compatibility**. The strict profile is an explicit
isolation deviation. The compatibility target is csvkit 2.2.0 / agate 1.14.2;
later-source `--ignore-unknown-columns` is rejected. No Sniffer is run.
Other codecs, quoting 1/2, compression, native error/traceback bytes, long-option
abbreviations and full Python grammar/NUL/encoding compatibility are unqualified.
`-z/--maxfieldsize` explicitly fails (status 1); malformed integer values fail
with status 2. Use `fieldBytes` for the bounded storage profile. Unknown options,
inference/locale/null flags and multiple operands fail with status 2.

Success returns status 0; selector/header/input/quota/unsupported-capability
errors return 1; argument/dialect errors return 2. Diagnostics use
`csvcut: <message>\n` when remaining quotas admit them. Host failures and
cancellation reject with their original identity, including falsey reasons.

Supply only intended memory/VFS capabilities: containment is the VFS provider's
responsibility. Cleanup enrolls before input acquisition, forwards explicit
signals, awaits writes and cooperative reads/retirement, and calls producer
`return()` once even at EOF. Closing generators disposes invocation state;
registered cleanup is idempotent. Await writes sequentially; consumers must
bound any retained output. A supplied `budget` run option requires its exact
signal, rejects separate limits and remains caller-owned.

Ordinary projection buffers bounded input/prepared output before emission;
validation does not make sink writes atomic. A BOM can precede failure and a
failed sink can leave completed records. Shell redirects open before reading:
redirecting onto the input or a symlink alias destroys it. csvcut creates no
temporary files and provides no atomic destination publication.
