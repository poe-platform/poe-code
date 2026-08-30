# html-to-markdown: bounded conversion profile

This family is available from root exports, the explicit
`virtual-bash/commands/html-to-markdown` subpath and `agentCommands`.
It adds no runtime dependency. Native programs are test
references only; the implementation never spawns a process, fetches a resource,
executes scripts or reads implicit host files.

## Public API and CLI

`src/commands/html-to-markdown/index.ts` exports:

- `createHtmlToMarkdownCommand(options?)`: one `CommandDefinition`.
- `createHtmlToMarkdownCommands(options?)`: readonly definitions containing only
  `html-to-markdown`.
- `htmlToMarkdownCommands(options?)`: `VirtualShellPlugin`, usable standalone.
- `HtmlToMarkdownCommandsOptions`: optional `replace` and
  `limits?: Partial<HtmlToMarkdownLimits>`.
- `HtmlToMarkdownLimits`: the fields listed below.

The root and explicit subpath export those same symbols. Aggregate configuration
uses `htmlToMarkdown: { limits: ... }`; it omits family `replace`, because the
aggregate's top-level replacement policy is authoritative. Curl and SafeJS remain
separate opt-in plugins.

`html-to-markdown [--] [FILE|-] ...` reads ordered VFS operands; no operands means
stdin. Repeated `-` shares one cursor, including EOF; it does not replay input.
`--` permits literal leading-dash filenames. `--help` and `--version` do not
acquire input. There is no implicit URL operand or `-o`; use an explicitly
registered curl pipeline and shell VFS redirection. No other options are claimed.

Status0 means conversion completed; invalid CLI usage is2, conversion/VFS/limit
failure is1 with a bounded command-prefixed diagnostic. Processing stops at the
first failed operand. Previously written operands or output prefixes are not
rolled back. Cancellation preserves the caller's reason rather than returning a
successful status. A sink failure is not successful conversion.

Pure conversion enrolls an owned stdout operation after argument validation.
Its input/parser/render work uses the operation signal and its accounted output;
stdout closure can cooperatively stop pending input before the first output byte.
Input cleanup registers on that operation before input acquisition, and completion
awaits iterator cleanup and operation close. Expected operation-closure rejection
is not a new command diagnostic; Shell maps EPIPE to141 for that stage. Caller
abort retains its original reason. Usage/FS/limit diagnostics use the original
caller context, not the closed stdout operation. File redirection uses its actual
destination rather than borrowing an unrelated pipe's close signal. This explicit
adoption does not settle opaque producer/return promises that do not cooperate.

## Rendering rules

- UTF-8 is decoded incrementally and strictly. Invalid or incomplete sequences
  fail, rather than silently substitute bytes. An initial UTF-8 BOM is ignored
  per operand; NUL becomes U+FFFD. ASCII HTML whitespace collapses outside code;
  NBSP remains NBSP. Ordinary Markdown punctuation is escaped. Inline boundary
  whitespace is retained/collapsed, not joined into adjacent words.
  In particular, numeric period/parenthesis prefixes, literal tildes and equals
  signs cannot become lists, strikethrough or setext headings. Harmless sentence
  punctuation need not be escaped. Code content is not Markdown-escaped.
- `h1`–`h6`, paragraphs and common structural block elements use ATX headings and
  blank-line block separation. `br` is a hard line break, `hr` a thematic break.
  `em/i`, `strong/b` and `del/s` produce emphasis/strong/strikethrough; the latter
  and pipe tables are Markdown extensions, not universal CommonMark features.
  Adjacent equivalent emphasis aliases coalesce, including through transparent
  elements; redundant same-style nesting is flattened. Different styles use
  distinct delimiter families where needed. Numeric character references at
  punctuation-sensitive text boundaries preserve delimiter flanking without
  adding visible markers or enabling raw HTML. These choices target the named
  CommonMark/strikeout profile, not every Markdown extension combination.
- Inline adjacency is normalized before contextual escaping and delimiter
  selection. Zero-output styles, empty raw code and inactive empty labels do
  not separate text or equivalent styles; transparent/inactive wrappers expose
  their children. Whitespace-only styles remain whitespace, not delimiters.
  Breaks, blocks, nonempty code (including spaces), and active links/images
  (including empty labels) retain their boundaries. An empty destination
  attribute remains inactive under the existing destination policy.
- Links and images preserve visible text/alt text, not arbitrary attributes or
  titles. Destinations allow HTTP(S), relative paths/fragments, and mailto for
  links only. They reject other schemes, network-path `//` references,
  backslashes, controls, percent-encoded ASCII controls, and unresolved entity
  references. HTML references are decoded once before policy checks. Dangerous
  or unsupported destinations become inactive labels, not active Markdown.
  Controls are checked before removing leading/trailing ASCII spaces: an edge
  TAB/LF/C1 control is refused, not stripped into an accepted destination.
  Spaces/syntax delimiters are percent-encoded; normal query separators remain.
- Ordered/unordered lists preserve nesting through indentation. `ol start`
  accepts1–999999999, otherwise defaults to1. `li value`, reversed lists and CSS
  list styles are not implemented. Blockquotes prefix preserved block lines.
- Code spans/fences choose a backtick delimiter longer than any content run;
  code-span edge padding follows the declared whitespace policy. Preformatted
  CR/CRLF becomes LF, with other spacing/blank lines retained. A code child's
  simple `language-NAME` class supplies a bounded fence label. No highlighting or
  code execution occurs. Non-NUL control bytes in pre/code are text, not a
  terminal-sanitization guarantee.
- Tables retain row/cell order and text. First-row `th` makes that row the
  header; otherwise an empty header is inserted rather than promoting data.
  Ragged rows are padded, cell line breaks collapse to spaces, and pipes are
  escaped, including in code. Captions/loose table text are retained above it.
  `colspan`/`rowspan`, alignment and complex layout are not simulated; text occurs
  once in its source cell. This is not a browser table-layout algorithm.

## Tokenizer, malformed input and entities

A stateful tokenizer handles text, quoted/unquoted tags, comments and raw text;
it is not regex-only stripping. Parsing is case-insensitive for tag/attribute
names; duplicate attributes keep the first value. Void elements do not push
stack frames. Self-closing syntax is honored for nonvoid elements in this
profile, unlike some browser HTML cases. Limited repair closes open paragraphs
at block starts, list items at sibling items, table rows/cells and nested anchors.
An unmatched closing tag is ignored; open elements finish at EOF. Malformed or
unterminated ordinary tags are retained as escaped text, not emitted raw HTML.

Scripts/styles and comments/declarations are dropped, including unterminated
script/style/comment tails. Raw closing script/style tags accept case-insensitive
names and ASCII trailing whitespace, not arbitrary closing-tag attributes.
Title/textarea preserve markup as text and decode entities; xmp/iframe/noembed/
noframes preserve raw literal content. Plaintext preserves the rest of the file.
Unknown ordinary elements retain children/text. There is no CSS visibility,
foreign-namespace tree building, browser error recovery or complete HTML5 claim.

Semicolon-terminated decimal/hexadecimal numeric references and the following
named references are supported: amp, lt, gt, quot, apos, nbsp, copy, reg, trade,
hellip, ndash, mdash, lsquo, rsquo, ldquo, rdquo, bull, middot, euro, pound, yen,
cent, times, divide, colon, Tab, NewLine. Unknown/unterminated references remain
literal, escaped against a second Markdown entity decode. Numeric zero,
surrogates and out-of-range scalars become U+FFFD; there is no Windows-1252 numeric
remapping. Unsupported reference grammar is not silently discarded.
An unfinished reference is retained across text fragments. If it cannot fit
the configured token bound, conversion fails with EFBIG instead of succeeding
with different text. For example, `&amp;` needs a token bound of at least5 bytes;
cap4 fails explicitly. This is a limit refusal, not an alternate entity dialect.

**This converter is not a sanitizer.** It has no arbitrary raw-HTML passthrough,
but generated Markdown is still untrusted content. Downstream renderers have
different extensions, link behavior and security policies. Remote images/links
can be requested later by a renderer; this command never requests them. Its
destination policy is not universal browser/DNS/socket confinement.

Link/image `title` attributes are not rendered. Title-preservation expectations
remain unsupported; this is not Pandoc-equivalent Markdown formatting.

## Bounds, streaming and ownership

| Limit | Default |
| --- | ---: |
| `maxInputBytes` |8388608|
| `maxOutputBytes` |16777216|
| `maxTokenBytes` |65536|
| `maxTokens` |200000|
| `maxNodes` |100000|
| `maxDepth` |128|
| `maxAttributes` per tag |64|
| `maxTableCells` including generated padding/header cells |10000|
| `maxTableCellBytes` |65536|
| `maxFiles` |64|
| `maxArgumentBytes` |65536|
| `maxDiagnosticBytes` |8192|
| `maxWorkUnits` |67108864|

Limits are positive safe integers up to64Mi, with additional ceilings256 depth,
1MiB token and1024 attributes. Configuration is copied/frozen at construction.
Input/output/token/node/cell/work counters are shared across operands; depth,
token size and cell size are local maxima. Independent maxima do not promise
every worst-case combination fits the work budget. Text is emitted as bounded
tokens; comments count against token size, dropped raw bodies still charge
input/work. Node count excludes the fixed document root. These logical bounds
are not process RSS guarantees.

Each operand is parsed into a bounded tree and serialized into a bounded
Markdown string before output. This is **bounded buffering**, not constant-memory
or immediate-output HTML streaming. Input decoding is chunk-safe; borrowed
fragments are copied before producer advancement/finalization or asynchronous
checkpoints. Output writes are chunked and awaited for real backpressure. VFS
stream reads receive cancellation; fallback reads receive the remaining byte cap.
Providers remain responsible for honoring their readFile bound before allocation.

Cooperative work checkpoints permit cancellation during long parsing/rendering.
Whitespace normalization/edge trimming, destination validation and entity scans
use charged linear or bounded-window scans with cooperative checkpoints. The
work bound also applies to attribute scanning and Markdown-boundary traversal;
it is not just an input-size check. Native string copies/joins and fixed bounded
token operations are not individually preemptible or hard wall-time guarantees.
Inline normalization charges visits, cached classifications and retained
reference slots before growth. It uses cached per-container sequences and
append-only coalescing, not repeated accumulated-prefix copies; transparent and
empty chains are traversed without building flattened arrays at each wrapper.
Nested nonempty formatting still consumes depth-dependent rendering work under
the same work cap. The normalized references are additional bounded retained
state, not a constant-memory claim or a separate unbounded normalization budget.
Cleanup registers before acquisition, closes acquired iterators idempotently,
and preserves primary execution/caller-abort failures over secondary cleanup.
Opaque host-provided producer/return promises are not hard-preemptible; cleanup
can await a cooperative producer's return. No arbitrary timeout abandons an owned
worker, and there are no regex workers, network sessions or native children here.

## References and verification boundary

The author consulted the WHATWG HTML tokenization/tree-building specification and
CommonMark0.31.2 code span, fence, escape and destination rules as design references.
This profile does not implement those specifications in full. Installed
Pandoc3.10.1 is a separate comparative conversion reference, never a runtime
dependency or an identical-CLI/format oracle. Its differing Markdown choices and
unsupported cases must remain visible. Different-agent review is required before
public/default integration or a broader support claim.
