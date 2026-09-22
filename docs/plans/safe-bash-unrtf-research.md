# UnRTF 0.21.10 behavior and acceptance matrix

Research task `research-unrtf`, inspected 2026-09-20 at local main
`35d01c57f8078d8afa916dc59929395d857e9c55`, with unrelated working-tree changes.
This document specifies future admission; it does not implement or qualify an
unrtf command. No existing command package, registration, public unrtf export or
unrtf implementation tests were found in HEAD or the working tree. Do not mark
engine, rendering, wiring or installed-consumer tasks complete from this research.

## Authority and reproducibility

Native authority: GNU UnRTF 0.21.10, official archive
<https://ftp.gnu.org/gnu/unrtf/unrtf-0.21.10.tar.gz>, freshly downloaded SHA256
`b49f20211fa69fff97d42d6e782a62d7e2da670b064951f14bbff968c93734ae`.
Include the archive's output personalities, not just the executable version.
The standards extraction profile references Microsoft RTF 1.9.1 separately;
existing Pandoc evidence reports unsuccessful primary-spec retrieval, so no
verified specification hash is claimed here.

Fresh native oracle: built using `./configure` and `make -j2` on Darwin arm64,
Apple clang 17.0.0; system iconv (not a separately hashed portable codec build).
All fresh conversions set `UNRTF_SEARCH_PATH` explicitly to this archive's
`outputs` and capture raw stdout/stderr bytes and process status. Native programs
are development-only oracles, never runtime dependencies. No ambient personality,
locale or codec availability is admitted into the product contract.

Pinned asset SHA256:

| Archive asset | SHA256 |
| --- | --- |
| text.conf | 11a5d1f481be9a22939c13d8da97fd0cfc3a919cfb8d2e4e6bc01d25c9bf38ec |
| html.conf | 204691a0473f8902d1be794b4e6743dac868bcedc40ad1c04cce30418966a482 |
| rtf.conf | 4a3f3b30b32b73e05d807a637ecefcdeab010c3739030531839e7585a5767dc7 |
| latex.conf | 0c8f819e91ab294c4805b352a35319d0249048abb98ad1bb3a7c380cad16d59e |
| vt.conf | 919bfb743380acbc04a033370b1c930528e802444e6bc12eb6a96eee1580d1bd |
| troff_mm.conf | 4f2b7fddc231c33d3b4f46a088e658d58e8a706191a7701cfb3dba8d209f7bf4 |
| SYMBOL.charmap | 5c512ede5d31038267b8c149dfc35675fe42b4d81875a2893efa8914427b4e3b |

Source ownership: `src/main.c` argument order/config loads; `src/parse.c`
`read_word`, `word_read`, `my_getchar`, `my_skip` byte token tree;
`src/convert.c` `word_print_core`, `find_command`, `cmd_u`, `cmd_field`,
`read_font_decl`, `flush_iconv_input`, pictures and tables;
`src/output.c` `op_translate_char`, `op_translate_buffer` personality aliases;
`src/my_iconv.c` iconv and charmap fallback. Upstream is GPL-3.0-or-later;
copying source/personality/charmap assets needs explicit license/notice review.
Behavioral research does not authorize copying these into MIT packages.

## Package and reuse boundary

The requested pattern document is deleted in the current working tree; inspect
its HEAD version and the existing relocation at
[archive/safe-bash-command-package-pattern.md](archive/safe-bash-command-package-pattern.md)
without restoring or changing unrelated work. Responsible owner remains
`packages/safe-bash-command-unrtf`, manifest `safe-bash-command-unrtf`, private,
TypeScript ESM, zero external runtime dependencies. Safe Bash only composes and
exports `@poe-platform/safe-bash/commands/unrtf`; no default registration is
implied. Use canonical private contracts, with no dependency back to safe-bash.
Bundle implementation, declarations and explicitly admitted assets into the
public artifact. Installed runtime and strict NodeNext consumers must work
without installing any private workspace or resolving bare private imports.
Do not publish the command package.

Current proven reuse candidates are `packages/pandoc/src/rtf-syntax.ts`,
`rtf.ts`, `rtf-pictures.ts` and `rtf.test.ts`. The tokenizer uses an explicit
bounded stack, validates signed parameters/hex/header/group closure and consumes
opaque binary bytes before decoding. It currently takes one buffered Uint8Array,
not an incremental tokenizer; producer-chunk tests do not prove streaming memory
bounds. Its context charges references/retained bytes/binary/work and cooperates
for cancellation. Reuse this proven grammar through a narrow first-party owner
or qualified adaptation; do not create a competing partial grammar. Extraction
must retain error/context ownership and establish a cycle-free build closure.

Pandoc tests establish scoped formatting, fonts/colors, rectangular tables,
inert hyperlinks, PNG/JPEG resources, Unicode/surrogates, fallback units and
strict errors. They establish only codepages 1252/65001, reject other font
charsets and active fields, and do not establish UnRTF personality output.
Whole Pandoc imports external dependencies (`entities`, `parse5`, `saxes`,
`jpeg-js`, `jsonc-parser` and transitive dependencies); it is not an admissible
zero-external-dependency command engine. Its RTF reader/writer plans already
record implementation; reuse tests rather than assuming the older prose's
“writer unavailable” statement remains current. Fresh focused verification:
`npx vitest run packages/pandoc/src/rtf.test.ts`: 68 passed, zero failures.

## Exact flag contract

| Native control | Pinned behavior | Product admission |
| --- | --- | --- |
| No format flag | Loads html if no configuration was loaded | Default HTML, pinned personality |
| --text/--html/--rtf/--vt/--latex | Calls get_config into existing personality, in argv order | Text/HTML required; other formats separate gates |
| Multiple format flags | Merge fields; not simple last-wins | Preserve ordered merge for admitted personalities |
| -t NAME | Merges config when next arg exists and does not start with '-' | Explicit bounded VFS config only; otherwise E_OPTION |
| -P PATH | Changes search path for subsequent loads only | VFS-only explicit path, no host/env search |
| Unknown --NAME, including -- | Searches NAME.conf (empty name for --) | E_OPTION for unadmitted personalities; no ambient lookup |
| No operand | stdin | Byte stdin |
| One operand | Exact open, then appended .rtf retry | Same within VFS only |
| '-' or second operand | usage, not conventional stdin/operand controls | Explicit E_OPTION; do not silently reinterpret |
| --quiet | Omits initial comments; not all warnings or body_begin | Preserve profile comments/separators independently |
| --nopict / -n | Suppresses native cwd pictNNN files | Suppresses VFS image exports |
| --inline / --simple / --noremap | Different rendering/remap behaviors | Independent fixtures required before admission |
| --debug / --dump / -d / --verbose | Debug/tree/information output, not ordinary conversion | Independent profiles; reject until qualified |
| --version / --help | Native version writes stderr; help uses usage | Separate exact-byte admission controls |

There is no generic native input-encoding CLI switch. Encoding comes from RTF
`ansi`, `mac`, `pc`, `pca`, `ansicpg`, font `cpg`/`fcharset`, personality aliases
and iconv/charmaps. Do not invent `--encoding` and call it native-compatible.
Malformed native `-P` handling must not be reproduced as unsafe memory behavior.
No host environment, locale, config paths, URLs or dynamic downloads may resolve
missing product configuration/codecs.

## Independent exact native controls

All fixture strings below are ASCII bytes with literal RTF backslashes. Output
notation uses byte escapes; concatenation is exact, with no implicit newline.
Define T = `\n-----------------\n` (17 hyphens), H =
`<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN">\n<html>\n<head>\n<meta http-equiv="content-type" content="text/html; charset=utf-8">\n`,
J = `</head>\n<body>`, E = `</body>\n</html>\n`.
These are fresh oracle controls, independent of future implementation tests.

| ID / fixture | argv | stdout | stderr / status |
| --- | --- | --- | --- |
| basic: `{\rtf1 Hello}` | --text --quiet | T + Hello | empty / 0 |
| basic | --html --quiet or --quiet | H + J + Hello + E | empty / 0 |
| merge-forward: basic | --text --html --quiet | H + J + Hello + E | empty / 0 |
| merge-reverse: basic | --html --text --quiet | H + `</head>\n` + T + Hello + `</html>\n` | empty / 0 |
| non-RTF: `Hello` | --text --quiet | T + Hello | empty / 0 |
| unclosed: `{\rtf1 Hello` | --text --quiet | T + Hello | empty / 0 |
| fallback0: `{\rtf1\uc0\u945?X}` | --text --quiet | T + ?X | empty / 0 |
| fallback1: `{\rtf1\uc1\u945?X}` | --html --quiet | H + &alpha; + E | empty / 0 |
| fallback2: `{\rtf1\uc2\u945??X}` | --html --quiet | H + &alpha; + E | empty / 0 |
| basic | --text --quiet -- | empty | `failed to find .conf in search path dirs\n` / 1 |
| basic | --text --quiet --missing | empty | `failed to find missing.conf in search path dirs\n` / 1 |
| basic | --text --quiet - | empty | U / 253 |

U is exactly `Usage: unrtf [--version] [--verbose] [--help] [--nopict|-n] [--noremap] [-P config_search_path] [--html] [--text] [--vt] [--latex] [--rtf] [-t <file_with_tags>)] <filename>\n`.
Status 253 is the captured POSIX process status, not a portable SDK negative code.
Not every rendering path emits body_begin: hex-only controls below omit T/J.
Do not infer wrapper presence from text.conf alone.

Binary fixtures: bytes `b'{\\rtf1 BEFORE\\bin' + ascii(N) + b' ' +
b'A'*N + b'AFTER}'`, cross seekable file and piped stdin,
`--text --quiet`. All 22 controls freshly reproduced:

| N | Native file stdout / status | Native stdin stdout / status | stderr |
| --- | --- | --- | --- |
| 0,1,4,2000,2020 | T + BEFOREAFTER / 0 | T + BEFOREAFTER / 0 | empty |
| 2030,2040,2048,2050,4096,8192 | T + BEFORE / 0 | empty / 10 | file empty; stdin `Error (line 0): Cannot seek\n` |

Source READ_BUF_LEN=2048; my_skip resets buffered counts before seeking from an
already advanced FILE position. cmd_bin is a no-op. This is an upstream defect,
not admissible successful suffix loss. Corrected product expects T + BEFOREAFTER,
empty stderr, status 0 on both input modes for every valid N. Payload must be
consumed raw across chunks, including braces/backslash/NUL/CR/LF/tab; validate
count before arithmetic and report truncation. Qualify chunk sizes 1/2/7/2047/
2048/2049 and deterministic randomized boundaries independently.

Encoding fixture: `{\rtf1\ansi\ansicpgCP \'41` followed by escaped suffix
bytes and `}`. Fresh controls, all stderr empty/status 0:

| CP / suffix hex | Exact text stdout hex | HTML stdout |
| --- | --- | --- |
| 932 / 82a0 | 4142 | H + A&#12354; + E |
| 936 / d6d0 | 412d | H + A&#20013; + E |
| 950 / a4a4 | 412d | H + A&#20013; + E |
| 949 / b0a1 | 41 | H + A&#44032; + E |
| 1251 / c0 | 4110 | H + A&#1040; + E |
| 1252 / 80 | 41ac | H + A&euro; + E |

Text low-byte projection and NUL loss are native output.c C-string behavior,
not UTF-8. cmd_u emits an alias/unisymbol then skips one Word node regardless
uc; text without such templates can retain fallback. Generic negative u adds
65536, but alias lookup gets original parameter. HTML surrogate entities need
separate native controls; standards extraction combines paired surrogates.
EOF and state-boundary decoder flushing must preserve every valid prefix.

User-supplied prior controls (not freshly reexecuted here): 98 encoding cells
(six CPs × six run shapes × text/html, plus 13 fcharsets × text/html), and 21
HTML decoder-buffer controls. They report valid-prefix loss/reordering on EINVAL
and N=10238 complete CP932 losing 2558 of 10238 As. Reconstruct the latter with
N repeated `\'41` then `\'82\'a0`, incomplete `\'82`, or
`\'82\b\'a0`, N=10235..10241. Preserve those exact reported counts in
independent oracle qualification; iconv platform provenance remains incomplete.
No missing-config invocation is semantic proof. Do not count these prior cells
as fresh product passes or invent full stderr/wrapper bytes from entity excerpts.
EOF truncation/split formatting must never discard valid prefixes in the product.

## Complete source encoding inventory

Native fcharset mapping (unknown -> 1252):

| fcharset | codepage |
| --- | --- |
| 0,1,2 | 1252,0,42 (SYMBOL), respectively |
| 77,78,79,80,81 | 10000,10001,10003,10008,10002 |
| 83,84,85,86,87,88,89 | 10005,10004,10006,10081,10021,10029,10007 |
| 128,129,130,134,136 | 932,949,1361,936,950 |
| 161,162,163,177,178,186 | 1253,1254,1258,1255,1256,1257 |
| 204,222,238,254 | 1251,874,1250,437 |

Explicit font cpg overrides fcharset. Missing metadata plus a font name containing
symbol selects SYMBOL; exact Symbol overrides supplied cpg. CP0 uses document
fallback. Default-font/ansicpg heuristics need original controls, not assumptions.

Native cptoencoding explicitly names CP437,708,709,710,711,720,819,850,852,860,
862,863,864,865,866,874,932,936,949,950,1250..1258,1361,10001,57002..57007;
42 -> SYMBOL; 10000 -> MAC; 10004 -> MACARABIC; 10005 -> MACHEBREW;
10006 -> MACGREEK; 10007 -> MACCYRILLIC; 10029 -> MACCENTRALEUROPE;
10081 -> MACTURKISH; unlisted numbers -> CP1252. Thus some mapped fcharsets
fall through to CP1252; do not assume a modern codec mapping is native parity.
Only SYMBOL.charmap is shipped. my_iconv_open tries system iconv first then
searches for a charmap. This source inventory is not a claim every codec exists
on every native platform. Product must supply versioned deterministic codecs/
assets or fail E_ENCODING; no ambient charmap/locale reads. Full availability
and scalar/entity/raw-byte controls are blocking admission cells.

## Deliberate deviations and error contract

Future CLI/SDK use the same engine, ordered options, budgets and structured
error code. Proposed CLI diagnostic bytes are `unrtf: CODE: MESSAGE\n`;
SDK preserves code/message/byte offset separately. These are specified acceptance
expectations, not existing implemented behavior. Failures produce no committed
stdout or image artifacts; bounded staging must be accounted for before publish.

| Original failure fixture / trigger | CODE: MESSAGE | status |
| --- | --- | --- |
| `Hello`, empty bytes or PNG/PDF/ZIP signature outside RTF | E_FORMAT: Input is not an RTF document | 1 |
| `{\rtf1 Hello` | E_PARSE: Unclosed RTF group | 1 |
| `{\rtf1\'gg}` | E_PARSE: Malformed RTF hex escape | 1 |
| `{\rtf1\bin-1 x}` or `{\rtf1\bin x}` | E_PARSE: Invalid RTF binary count | 1 |
| `{\rtf1\bin4 x}` | E_PARSE: Truncated RTF binary payload | 1 |
| Unknown/unavailable document or font codec | E_ENCODING: Unsupported RTF code page N | 1 |
| Incomplete sequence at EOF or formatting/font/group boundary | E_ENCODING: Truncated RTF code-page sequence N | 1 |
| Invalid sequence | E_ENCODING: Invalid RTF bytes for code page N | 1 |
| Unadmitted option/personality or malformed arity | E_OPTION: Unsupported or invalid option ARG | 2 |
| Exact and .rtf VFS opens fail | E_IO: Cannot open input file | 1 |
| Depth/node/token/image/decoded/output/work budget exhausted | E_LIMIT: RTF LIMIT budget exceeded | 1 |
| Explicit abort before or during conversion/publication | E_CANCELLED: Conversion cancelled | 130 |
| Image target already exists | E_IO: Image output already exists | 1 |

N, ARG and LIMIT are exact contextual values, not locale strings. Escape unsafe
argument bytes deterministically before display. Exact offset and precedence
controls are required in implementation tests before this contract is accepted.
Native permissive non-RTF/unclosed-group/malformed-hex recovery is deliberately
excluded. Valid bin remains opaque regardless of byte contents; “binary error”
means invalid/truncated bin, not rejection of all RTF binary payloads.

Keep three profiles distinct: pinned native-legacy personality/Unicode output;
standards extraction with scoped uc and surrogate pairing; recovery (unadmitted
until a bounded policy and diagnostics are pinned). Safety deviations apply even
to native-legacy; it never emulates seeking, silent decoder data loss, unsafe
counts or host side effects. Profile selection must be explicit in both CLI and
SDK before claiming either standards correctness or version compatibility.
Raw native text paths ignore CR/LF, map tab to space, collapse spaces and map
backslash-LF to par; standards whitespace is independently qualified.

## Blocking admission matrix and QA handoff

Every row requires original failing implementation tests before code, plus
independent compatibility fixtures that do not obtain expected values from the
engine under test. Native controls may run only in a separate development QA
procedure; unit tests use memory VFS/memfs and mocked capabilities. Store durable
fixture bytes/expected outputs or byte-escape specifications independently of
implementation tests. Record source/profile/codec/platform provenance per cell.
No optional skip or unavailable codec counts as a pass.

| Cell | Required independent expectations | Current evidence / gate |
| --- | --- | --- |
| Args and personalities | Exact default/text/HTML, ordered merges, quiet on/off, -P before/after load, -t merges, missing args/config, operands/.rtf retry | Fresh basic/merge/errors above; remainder unqualified |
| Lexical paths | Escapes/hex/control symbols, CR/LF/tab/spaces, backslash-LF, malformed headers/groups/parameters | Pandoc grammar tests; native lexical byte fixtures still required |
| Binary | All 22 controls, original opaque-byte boundary cases, truncation/overflow | Upstream defect reproduced; corrected streaming admission pending |
| Unicode | uc0/1/2, one-node legacy skipping, aliases/negative values, paired/unpaired surrogates | Fresh legacy subset and Pandoc standards tests; complete profiles pending |
| Codepages | Full source table, ansi/mac/pc/pca, font cpg priority, default font and Symbol, raw/hex/mixed runs | Six fresh native codec controls; full codec/charmap availability pending |
| Decoder flush | Formatting/font/group/text boundaries, EOF, all 10235..10241 buffer cells and producer chunk sizes | Prior supplied findings; no product decoder qualified |
| Fields/objects/macros | Render admitted field results; preserve inert labels; never follow URLs, fetch resources or execute instructions | Pandoc HYPERLINK/active-field rejection tests; native result policy pending |
| Tables and styling | Empty/multiple cells/rows, groups, bold/italic/color/font/size, escaping/entities and whitespace | Pandoc subset tests; exact native text/HTML output pending |
| Pictures | nopict/-n, PNG/JPEG/native type inventory, VFS-only names/bytes, collisions, limits, failed/cancelled cleanup | Pandoc encoded resources only; UnRTF export semantics pending |
| Resource accounting | Explicit finite defaults and lower-only overrides for input/retained bytes, group depth, nodes, token bytes, images/image bytes, decoded units, output and work | Pandoc charge hooks; command numeric limits not yet qualified |
| Cancellation/reentrancy | Abort at each parser/decoder/render/write phase; iterator closure; interleaved calls with different fonts/pages/profile | No UnRTF implementation; invocation-local state required |
| Isolation/ownership/replay | Denied process/fs/network/env/locale; canonical carrier and error identities; owned bytes; cleanup/rollback including falsey throws; deterministic replay | Responsible package/contracts acceptance pending |
| CLI/SDK integration | Same argv/options/profile/status/bytes through files/stdin/pipes/scripts; opt-in collision preflight | No UnRTF wiring yet |
| Installed artifact | Public subpath and strict types, no unpublished install/bare private imports, one canonical contracts owner, assets/licenses, no external runtime closure | No UnRTF artifact yet |
| Auxiliary profiles | rtf/vt/latex, inline/simple/noremap, debug/dump/verbose/help/version | Not admitted by text/HTML research |

QA is this markdown procedure, not a new QA script: reproduce pinned native
fixtures with exact config provenance; record stdout/stderr/status as bytes;
run corrected-profile fixtures through SDK and Shell against memory VFS; compare
only the admitted profile; test denied capabilities and cleanup; inspect CLI
screenshots once wiring changes visible output; run maintained focused package
lint/unit/build routes and installed tarball runtime/declaration consumers.
Broaden checks if shared grammar/contracts/build infrastructure changes.

Research receipt: archive and personality/charmap hashes verified; 13 argument/
format/Unicode/malformed controls, 22 file/pipe binary controls and 12 encoding
controls executed freshly; existing 68 Pandoc RTF tests passed. No runtime code
changed, so no new unit tests or CLI screenshots were necessary for this document.
`git diff --check` passed for the owned document. `/out` is read-only on this host;
temporary archive/build/fixtures used ignored `out/research-unrtf` and were
purged after durable capture. No commit, push, remote-main verification, release,
standalone package publication or full implementation acceptance is claimed.
