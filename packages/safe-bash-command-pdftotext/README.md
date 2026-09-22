# pdftotext VFS admission profile

Bounded, cancellable primitives for admitting pdftotext arguments and serializing
already extracted text. **PDF extraction is unavailable.** This private workspace
exposes an opt-in command and SDK through
`@poe-platform/safe-bash/commands/pdftotext`. Extraction requests fail with status
99 before consuming input or creating output; this is an unavailable-capability
status, not a claim about native PDF-open errors.

| API | Behavior |
| --- | --- |
| `parsePdftotextArguments(args, signal, limits?)` | Exact option matching, explicit unknown-option rejection, repeated values, delimiter handling, format/order precedence and conservative argument accounting. |
| `normalizePageRange(first, last, count)` | Normalize first/last sentinels and reject reversed or invalid ranges. |
| `defaultOutputName(input, htmlMeta, signal, limits?)` | Return a checked default filename and accounting; stdin requires an explicit output. |
| `encodePdftotextOutput(text, encoding, eol, signal, limits?)` | Encode canonical LF-delimited text using UTF-8, big-endian UTF-16 without BOM, Latin1 or ASCII7. |
| `serializeBboxWord(text, box, signal, limits?)` | Escape one supplied word and serialize finite ordered output coordinates with six decimal places. |

Encoders return owned byte arrays and accounting. Spaces, line breaks and
formfeeds pass through the same encoding map. They preserve ligatures and reject
malformed or unrepresentable Unicode instead of inventing replacement text.
This strict encoding policy is an intentional deviation from native mappings
that omit unrepresentable characters.

Argument admission accepts well-formed Unicode strings with ASCII profile
identifiers. It rejects NUL, incomplete/sign-only numerics, exponent notation,
unchecked integers and nonpositive DPI. The default EOL profile is UNIX.
CLI password values are UTF-8 encoded and truncated to 32 bytes, including a
possible incomplete final sequence; SDK raw-password support is still pending.
Invalid EOL returns a diagnostic that must be emitted even in quiet mode.
The invocation layer implements help, version, the admitted encoding list,
encoding/hyphen validation and operand admission. Unknown-looking filenames
require `--` or an explicit relative/absolute VFS path. Unknown flags fail
explicitly rather than using native positional fallback. Attached/grouped flags
are not supported by the pinned upstream parser. CLI and SDK use the same
32-byte password profile; neither exposes a raw-password extraction API.
No extraction permission profile is advertised until a security engine exists.

These helpers perform no I/O and make no font, OCR, layout, page/crop transform
or security compatibility claim. Word boxes must already be
qualified and transformed by an extraction engine. They do not constitute a PDF
parser. There are no external runtime dependencies or runtime fallbacks.

```ts
import { Shell, createMemoryFileSystem } from '@poe-platform/safe-bash';
import { pdftotextCommands } from '@poe-platform/safe-bash/commands/pdftotext';

const shell = new Shell({ fs: createMemoryFileSystem() });
try {
  shell.use(pdftotextCommands());
  const result = await shell.exec('pdftotext -listenc');
  console.log(result.stdout); // UTF-8, UTF-16, Latin1, ASCII7 (one per line)
} finally {
  await shell.dispose();
}
```

The SDK accepts literal `input`/`output`, numeric `numbers`, boolean `flags`,
encoding, EOL, hyphen and CLI-profile password options. Results report exit
status, written bytes and `extractionQualified: false`. Invocation limits bound
arguments and output; cancellation propagates and cleanup drains owned writes.
The package is private and must not be published independently.

## Commands and limits

After `shell.use(pdftotextCommands())`, run `shell.exec('pdftotext -h')`,
`shell.exec('pdftotext -v')` or `shell.exec('pdftotext -listenc')`.
`pdftotext /input.pdf -` currently returns 99 without opening either path.
Input/output operands are literal VFS paths; `-` denotes stdin/stdout, and
stdin requires an explicit output operand. Default-name admission removes only
`.pdf` or `.PDF`, then appends `.html` for HTML metadata, otherwise `.txt`.

All spellings below are **admitted**, not implemented extraction features.
Options match exactly, take separate operands and remain recognized after
ordinary filenames until `--`. Repeated value options use the last value.
Abbreviations, grouped flags and `--key=value` fail admission.

| Exact flags | Operand / admitted meaning |
| --- | --- |
| `-h`, `-help`, `--help`, `-?` | Help on stdout; status 0. |
| `-v` | Admission-profile version and reference pin on stdout; status 0. |
| `-listenc` | `UTF-8`, `UTF-16`, `Latin1`, `ASCII7`, one per LF-terminated line; status 0. |
| `-f`, `-l` | Checked integer first/last page; defaults 1/0. |
| `-r` | Complete finite decimal DPI greater than zero; default 72. |
| `-x`, `-y`, `-W`, `-H` | Checked integer slice geometry; defaults 0. |
| `-fixed` | Complete finite decimal pitch; nonzero selects physical order. |
| `-colspacing` | Complete finite decimal in (0, 10]; default 0.7. |
| `-layout`, `-raw` | Physical/raw order; raw wins over physical. |
| `-remove-hyphens` | `all` (default), `none`, `soft`; validation after help/version/listenc. |
| `-nodiag`, `-nopgbrk`, `-cropbox` | Record diagonal/page-break/crop preferences only. |
| `-htmlmeta`, `-tsv`, `-bbox`, `-bbox-layout` | Record format; bbox-layout implies bbox and HTML, bbox wins over TSV; HTML+TSV stays combined. |
| `-enc` | Listed encoding, default UTF-8; ASCII identifier truncated to 127 bytes. |
| `-eol` | `unix` (default), `dos`, `mac`; ASCII value truncated to 15 bytes. Invalid value diagnoses on stderr even with `-q`, then uses UNIX. |
| `-urls` | Rejected with HTML/TSV before help/version and quiet handling. |
| `-opw`, `-upw` | CLI-profile owner/user passwords, UTF-8 truncated to 32 bytes. |
| `-q` | Suppress initialized admission/extraction-unavailable errors; early errors remain visible. |
| `--` | End option recognition; admit subsequent literal operands. |

Hyphen values are ASCII and truncated to 15 bytes. Numeric admission rejects
exponents and native empty/sign-only/dot forms; this is a deliberate strict
profile. No password decryption, copy-permission enforcement or raw-password
SDK is implemented. No PDF-open/output-open/permission status 1/2/3 is claimed.
Help wins over version, which wins over listenc. Encoding validation follows
these controls; early numeric/column-spacing/URL checks precede them.

| Budget | Default |
| --- | --- |
| Invocation `maxArgumentBytes`, `maxOutputBytes` | 65,536 each; configurable checked integers from 0 through 1,048,576. Output includes stdout plus stderr. |
| Admission/name helpers: input / decoded / retained / work | 65,536 / 131,072 / 524,288 bytes / 1,048,576 work units. |
| Encoding/bbox helpers: decoded / output / retained / work | 16,777,216 / 33,554,432 / 50,331,648 bytes / 134,217,728 work units. |

Helper overrides are nonnegative checked integers; accounting includes owned
copies and conservative allocations. Helper errors are `PdftotextAdmissionError`
with exitCode 99; invalid invocation limits and output exhaustion throw
`RangeError`. Cancellation propagates the abort reason rather than an exit code.
Writes use byte streams and invocation-owned output cleanup is awaited.
Encoding returns owned bytes without a BOM or implicit final separator; bbox
returns a UTF-8 XML word fragment with six-decimal coordinates and a final LF,
not a rendered PDF/HTML document.

Runtime: TypeScript ESM, Node.js 22+. Private implementation and declarations
are bundled inside the public safe-bash artifact. Browser/workerd conditional
imports need their admitted shell/runtime prerequisites; conditional verification
is not qualification of actual browser or Workers engines. No host executables,
ambient files, network, native/WASM fallback or dynamic downloads are used.
The reference is Poppler 26.09.90 development snapshot at
`0595ca8e76f575e5f16ccc5ee6d4b552d31b0a46`; supplied native controls qualify
upstream observations, not this package's font/CMap/ActualText/layout parity.
