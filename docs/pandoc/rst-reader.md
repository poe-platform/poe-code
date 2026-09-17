# RST input

The built-in `rst` reader is original TypeScript in packages/pandoc. The SDK and
existing thin safe-bash command use the same reader. There is no Python/docutils,
Pandoc executable, shell, network or ambient filesystem runtime fallback. RST
output is documented separately; this document describes input only.

## Pinned syntax reference

Reference: **Docutils 0.21.2**, `docs/ref/rst/restructuredtext.txt`, distributed in
[docutils-0.21.2.tar.gz](https://files.pythonhosted.org/packages/ae/ed/aefcc8cd0ba62a0560c3c18c33925362d46c6075480bfa4df87b28e169a9/docutils-0.21.2.tar.gz).

- Release archive SHA-256:
  `3a6b18732edf182daa3cd12775bbb338cf5691468f91eeeb109deff6ebfa986f`.
- Syntax document SHA-256:
  `51511f2304db0b1472986bed1d16375d0f7d8494d2ff37ff473928d6bfcb3194`.
- [Readable RST specification](https://docutils.sourceforge.io/docs/ref/rst/restructuredtext.html)
  is a moving rendering; the release and document hashes above define the pin.

The archive and syntax document hashes were checked in memory during development.
No reference fixture is downloaded or executable invoked by unit tests. Tests are
original cases inspired by Readers.RST categories, not copied upstream fixtures or
a claim of complete Docutils/Pandoc parity.

## Block and inline projection

Heading levels follow first encounter of adornment styles. Overline-plus-underline
and underline-only forms are distinct styles; mismatched, unequal over/under and
short adornments fail with source locations. Titles produce implicit targets.
Four-or-more-character transitions require surrounding blank lines.

Paragraph continuation lines must align. Blank lines separate paragraphs and
introduce lists; the start of input acts as a blank line. Definitions require an
immediately indented body. Bullet bodies and decimal, alphabetic, canonical Roman
and automatic enumerations use the content column after their markers. Nested
lists, additional item paragraphs, definitions/classifiers and multiline fields
retain block content. Fields project to DefinitionList entries; classifiers remain
in the term text. Indented standalone blocks become BlockQuote. Tabs expand to
eight-column stops for parsing.

Literal blocks require a `::` introducer and a blank line. A standalone introducer
disappears; a trailing space-plus-introducer disappears; otherwise one colon
remains. Indented and punctuation-quoted bodies preserve internal blank lines and
literal markup. Line blocks retain line boundaries and continuation lines.

Emphasis, strong emphasis, escaped characters, inline literals, interpreted text,
hyperlinks, inline internal targets, image substitutions and footnotes map to
typed AST nodes. Interpreted roles accept prefix or suffix notation; specifying
both fails. Default interpreted text projects to a title-ref Span. Named and
implicit links resolve after all blocks; embedded named URIs establish targets.
Anonymous references pair with anonymous targets in encounter order. Missing,
duplicate and cyclic targets fail, including unused cyclic target definitions.
Standalone HTTP, HTTPS and mailto URIs become links.

Substitution references can carry named (`|name|_`) or anonymous (`|name|__`)
hyperlink suffixes. The expanded text/image becomes the link label; target
resolution, anonymous pairing and missing-target diagnostics follow ordinary
hyperlink rules.

Forward/nested replacement substitutions are case-sensitive and bounded by macro,
expansion, depth, work and memory ceilings. Missing and recursive substitutions
fail. Numbered notes, named/anonymous auto-number notes, auto-symbol notes and
citation labels project to Note bodies, retaining paragraphs. Cyclic note bodies
fail; counters are not evaluated by executing a reference processor.

Simple tables support optional headers, rows starting in the first column,
continuation cells and an unbounded rightmost column. Grid tables support optional
headers, multiline cells and independently parsed block content in cells. Cell
spans/partial separators are outside this initial projection and fail explicitly;
they are never flattened silently. Malformed borders and unclosed tables fail.

## Directive allowlist

| Directive | Supported arguments/options | Projection |
| --- | --- | --- |
| `replace` in a substitution definition | one inline paragraph; no options/structural blocks | bounded inline substitution |
| `image` (also in substitutions) | URI; `alt`, `height`, `width`, `scale`, `align`, `target`, `class`, `name` | Image, optionally wrapped in Link |
| `figure` | same image arguments/options; caption paragraph and legend blocks | Figure with image, caption and legend |
| `code`, `code-block`, `sourcecode` | optional language; `number-lines`, `class`, `name` | literal CodeBlock; number-lines becomes numberLines/startFrom |
| `attention`, `caution`, `danger`, `error`, `hint`, `important`, `note`, `tip`, `warning`, `admonition` | optional leading text; `class`, `name`; body blocks | Div with directive class |
| `container`, `compound` | container argument is classes; compound argument is text; `class`, `name` | Div |
| `rubric` | leading text/body; `class`, `name` | rubric Div |
| `epigraph`, `pull-quote` | leading text/body; no options | BlockQuote |
| `include` | relative resource name only; no options or body | explicit capability read, recursively parsed RST |
| `raw` | one output format, inline body only; no options | requires explicit loss/raw policy, diagnosed RawBlock |

Ordinary RST comments are non-rendering syntax. Other directives, substitution
directives, custom roles and unsupported options/bodies fail `E_CAPABILITY` by
default. Conversion with `lossy: true` or `rawContent: "retain"`/`"escape"` preserves
the entire unsupported declaration/options/body as RawBlock or RawInline with
`W_RAW_CONTENT`. Destination writers retain, escape or reject raw content under
their existing policies. `failIfWarnings` remains available. Unknown constructs
never succeed by dropping their body. `parsed-literal`, `contents`, `role`,
`default-role`, dynamic/date/unicode substitutions, document transforms, math
directives and custom table directives are not in the allowlist.

A blank line ends a directive's option header. Field-shaped text after that
separator belongs to the body: code/raw directives preserve it literally, and
admonitions parse it as a field list. Raw `file`/`url` header options still fail
before resource access.

## Role allowlist

| Role names | AST |
| --- | --- |
| `emphasis`, `strong` | Emph, Strong |
| `superscript`, `sup`, `subscript`, `sub` | Superscript, Subscript |
| `literal`, `code` | Code |
| `math` | InlineMath containing source |
| `title-reference`, `title`, `t` | title-ref Span |

No role registers code, loads a plugin or evaluates its text.

## Resources, options and diagnostics

There are no RST-specific environment variables, CLI flags or SDK options.
`from: "rst"` selects input. Existing conversion loss/raw policies and context
Limits apply. Strict `readDocument` has no raw-preservation option; conversion
supplies those policies. Images remain URIs until explicit media extraction.
Included-image origins retain the included source directory through the parser
sidecar (optional explicit origin in AdapterContext.resourceTarget).

Includes use only `ConversionContext.resources.resolve(id, base, signal)`.
The safe-bash adapter supplies that capability only from its explicitly configured
VFS. Stdin uses configured cwd; nested includes use their own resource directory.
Absolute names, parent traversal, schemes, backslashes, control characters and
tilde names fail even with a loss policy. Normalized active resource identities
detect cycles, and includes/depth/resources/resourceBytes/decoded-text/work/memory
ceilings bound expansion. The injected provider retains authority over its own
namespace; lexical validation does not sandbox an untrusted provider.

Raw `file`/`url` options always fail before acquisition, even with a loss policy.
Raw bodies and code blocks are source data; they are never executed. Include
failures prevent publication. Invalid UTF-8, cancellation, malformed source and
capability denial retain their explicit error codes. Main-source positions are
mapped by the SDK; included sources retain qualified line/column identities.
