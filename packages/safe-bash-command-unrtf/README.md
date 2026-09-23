# RTF byte-stream conversion

Extract document text from bounded RTF streams without accessing host files,
executing fields, opening links, or exporting embedded objects and pictures.
Use the public `@poe-platform/safe-bash/commands/unrtf` entry point. This private
workspace is bundled into safe-bash and is not published independently.

```sh
unrtf --text /document.rtf
unrtf --html /document > /document.html
cat /document.rtf | unrtf --text
```

Commands run inside a Safe Bash shell after explicit `shell.use(unrtfCommands())`;
paths and redirections use that shell's VFS.

```ts
import { extractRtf } from '@poe-platform/safe-bash/commands/unrtf';

const limits = {
  inputBytes: 1_000_000, retainedBytes: 100_000,
  binaryBytes: 500_000, images: 100, imageBytes: 500_000,
  tokenBytes: 1024, tokens: 500_000, depth: 100,
  decodedBytes: 2_000_000, outputBytes: 2_000_000, work: 5_000_000,
};
const signal = new AbortController().signal;
async function* input() {
  yield new TextEncoder().encode('{\\rtf1 Hello \\u945 ?}');
}
for await (const event of extractRtf(input(), { limits, signal })) {
  if (event.kind === 'text') console.log(event.text);
}
```

| API | Purpose |
| --- | --- |
| `tokenizeRtf` | Flat group/control/byte tokens; exact bounded binary skip |
| `extractRtf` | Strict Unicode extraction, font/color events, inert destinations |
| `renderRtf` | Bounded UTF-8 text or HTML byte streams |
| `unrtfCommands`, `createUnrtfCommand` | Opt-in shell registration and command definition |
| `unrtf(context, options)` | Equivalent SDK conversion with literal VFS file or stdin |
| `UnrtfError` | Stable error code, byte offset, status 1, and limit resource |
| `charsetCodePages`, `codecLabels` | Explicit source charset mapping and codec inventory |
| `unrtfBaseline` | Pinned source provenance and admitted extraction profile |

`standards-strict` is the default profile. `native-legacy` and `recovery`
fail with `E_PROFILE` before input is pulled. This is standards-oriented
extraction, **not GNU UnRTF 0.21.10 personality compatibility**.
`unrtfBaseline` pins the official source archive SHA256
`b49f20211fa69fff97d42d6e782a62d7e2da670b064951f14bbff968c93734ae`;
An explicit `gnu-0.21.10` profile uses scoped official text, HTML and LaTeX
personality templates and character aliases (GPL-3.0-or-later; see NOTICE).
Select it with `unrtf --profile=gnu-0.21.10 --latex /document.rtf` or
`unrtf(context, { profile: 'gnu-0.21.10', format: 'latex', file: '/document.rtf' })`.
The profile emits GNU document wrappers, banners, text separators, line breaks
and scoped bold/italic/underline/strike templates. `--quiet` suppresses its
banner; `--noremap` bypasses character aliases and can emit unescaped markup.
SDK options `quiet` and `noremap` provide the same behavior. Registration also
accepts `unrtfCommands({ profile: 'gnu-0.21.10' })`.
This is scoped output compatibility over strict extraction, not full native
parser, font/color/table or malformed-input parity. Strict Unicode and binary
handling, inert destinations, budgets and no exports remain in effect.

Text/HTML supports paragraphs, line breaks, tabs, flat table rows/cells, scoped
bold/italic/underline/strike, fonts, half-point sizes and foreground RGB colors.
HTML escapes text/font names; field instructions, links and objects stay inert,
while field results remain text. Pictures, metadata, stylesheets, exact `header`/`footer` destinations
and starred destinations are skipped. Header/footer variants such as `headerl`
and `footerr` currently remain ordinary content. Arbitrary GNU configurations,
picture exports, nested/merged tables and inherited stylesheet styles are
unimplemented.
Unknown rendering controls are ignored; extraction exposes them as events.

Codecs use fatal realm-local WHATWG `TextDecoder`, with no replacement or download.
The exported `codecLabels` lists candidates; unknown/unavailable pages, Symbol,
Johab and unlisted Mac pages fail `E_CODEC`. Font `cpg` overrides `fcharset`;
exact Symbol forces Symbol even with supplied `cpg`. Missing/charset-1 font pages
use the document page. Font names decode with scoped fallback and share budgets.
Native iconv/charmap/platform parity is not claimed.

Scoped `uc` counts fallback bytes/escapes (control words/symbols and complete
binary payloads count once); surrogate pairs combine. Unlike native token skipping
and low-byte projection, text is UTF-8 without a separator or invented final LF.
Raw CR/LF are ignored, raw tabs become spaces, spaces collapse and backslash-LF
becomes a paragraph. Binary reads consume exactly N raw bytes across chunks,
including CR, braces, backslashes and NUL, preserving file/stdin suffixes rather
than reproducing GNU's seek defect. Truncation/malformed roots, groups, hex or
counts fail `E_PARSE`; malformed encoding/unpaired surrogates fail `E_ENCODING`.
Valid decoded prefixes survive. Formatting preserves pending decoder bytes;
group/font/encoding/plain/Unicode/table boundaries flush and reject incompleteness.

Register `unrtfCommands()` with a shell. SDK conversion uses
`unrtf(context, { format: 'text', file: '/document.rtf', limits })`.
HTML is default. Omit the file for stdin; `-` is a literal filename. Only one
file is allowed; missing exact VFS paths retry with `.rtf` appended. `--` ends
options (an explicit GNU deviation). Unsupported flags fail `E_PROFILE`, status 1,
before input access; no ambient configuration search occurs.

| Supported CLI flag | Behavior |
| --- | --- |
| `--text` | UTF-8 text; no separator or added final LF |
| `--html` | Strict HTML projection (default), not GNU HTML personality output |
| `--quiet` | Accepted; this profile never emits initial comments |
| `--nopict`, `-n` | Accepted; this profile never exports pictures |
| `--` | End options; subsequent arguments are literal VFS operands |

`--profile=standards-strict` and `--profile=gnu-0.21.10` select the profile.
`--latex` and `--noremap` require the GNU profile; the latter has SDK option
`noremap`. `--help` and `--version` remain unsupported. The last format flag
wins. `--nopict` is unconditional in both profiles; SDK `quiet` controls the GNU banner.

| Limit | Command default |
| --- | ---: |
| `inputBytes`, `binaryBytes`, `imageBytes` | 16,777,216 each |
| `retainedBytes` | 1,048,576 |
| `images` | 1,000 |
| `tokenBytes` | 8,192 |
| `tokens` | 16,777,216 |
| `depth` | 256 |
| `decodedBytes` | 33,554,432 |
| `outputBytes` | 67,108,864 |
| `work` | 268,435,456 |

The command accepts partial `limits` overrides; stream APIs require all limits
and an `AbortSignal` explicitly. Limits must be nonnegative safe integers.
Success returns status 0; admitted document/profile/VFS failures return status 1
with bounded `unrtf: CODE: message\n` diagnostics on stderr. Cancellation and
unexpected capability failures reject rather than becoming successful output.

Runtime profile: TypeScript ESM, Node.js 22+, no external command runtime
dependencies. The engine requires realm-local `TextEncoder`, fatal `TextDecoder`,
`AbortController` and timers; codec availability is checked in that realm.
Browser/workerd conditional import verification qualifies the packed graphs,
not execution in those actual engines. No host executable, native/WASM fallback,
ambient file/configuration/environment reads, implicit network or dynamic
dependency download is used.

Parser, extraction, rendering and arguments share one invocation budget.
Accounting bounds retained chunks/group/font/style state, token spelling/count,
input, binary/image bytes/count, decoded/output UTF-8 bytes and work. Binary
payloads are not retained; skipped pictures still count. Emitted events/bytes
become caller-owned. Borrowed source chunks must remain immutable; byte views
from other realms are accepted, forged/non-byte views fail `E_PARSE`.

Cancellation or early return requests source `return()` even during a pending
pull. Sources must implement prompt cleanup; the engine cannot forcibly terminate
an uncooperative source. Cleanup preserves an existing failure and otherwise
propagates cleanup errors. Invocation state is local and limits are snapshotted.

Output streams can deliver a prefix before failure; discard it on nonzero status.
Diagnostics have a separate `tokenBytes + 1024` byte bound. Input acquisition
errors emit no document/header bytes. No VFS outputs or images are created by the
command. Shell redirection truncates its destination before conversion and is
not atomic: redirecting onto the input (including a symlink alias) destroys it,
and failures can leave partial output. Callers own exclusive/atomic publication.
