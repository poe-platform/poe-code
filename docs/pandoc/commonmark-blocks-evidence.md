# CommonMark block-phase evidence

Verified 2026-09-16 against the original TypeScript source in this checkout.
This records scoped block-phase verification, not complete CommonMark reader
conformance or a delivered conversion capability.

## Implementation boundary

`packages/pandoc/src/commonmark-blocks.ts` exposes an internal
`parseCommonMarkBlocks(text, context, source)` phase. The container stack parses
quotes, ordered/bullet lists and items; leaf state parses paragraphs, ATX/setext
headings, thematic breaks, fenced/indented code and the seven HTML block types.
A separate bounded grammar scanner extracts leading link definitions.
Nested syntax is not parsed by regex substitution. There is no filesystem,
environment, subprocess, native fallback, network or LLM dependency in this
phase. The existing safe-bash adapter and format registry are unchanged.

Paragraphs and headings carry `PendingInline`, with original inline source
runs and their starts. These are explicitly temporary tokens, with no final
Pandoc `Str`/`Para` constructors. Lists carry items, numeric start/delimiter and
local tightness. Tightness is structural data for later AST assembly.
Definitions retain raw destination/title syntax; code info retains raw syntax
for the later escape/entity decoding phase. Definition label identity uses
whitespace normalization and Unicode default full case folding, first wins.

Source ranges and pending source-run starts use one-based original line and
UTF-16 column offsets; tabs advance indentation to four-column stops while
retaining mappings to the original source character. Literal code/HTML retain
source CRLF and tabs, except indentation consumed by block/container syntax
and partial consumed tabs represented by their remaining spaces. Prose runs
use LF between lines. A literal final content line without an ending receives
LF, matching block code semantics; trailing indented-code blank lines are
excluded. Range ends exclude line-ending characters.

Open containers and leaves check `depth`; blocks/items charge `nodes`.
Definition reservations charge `references`, including duplicates. Pending
definition/paragraph buffers also check the reference ceiling before extending
their line arrays. Original/expanded line size checks `text`, scanner/parser
steps charge `work`, and retained source/state allocations charge
`retainedBytes`. Long-line scanning cooperates every 256 characters and checks
cancellation. Hosts can lower the existing execution ceilings. No new options
or environment variables are exposed.

CommonMark is not bound to the registry's reader capability and remains absent
from available input formats. The phase does not yet decode inline syntax,
assemble a final validated document, resolve resources or admit raw HTML for
conversion. Those operations require their own verification before activation.

## Independent original tests and failing-first observations

Expected trees in `commonmark-blocks.test.ts` are handwritten facts about block
structure, inspected directly through kind, content, list state and children.
No writer/parser round trip, rendered HTML oracle or fabricated final text
nodes establish the expectations. All cases are original strings; no downloaded
fixtures or external executables run in unit tests. Tests perform no filesystem
mutations, so no host scratch files or memfs mutation harness is needed.

The initial maintained test run failed because the phase module was absent.
Subsequent original cases failed before fixes for ordered sibling recognition,
nested list tightness, empty-item leading blanks, definition title fallback,
multiline labels, control characters, alternate HTML raw closing tags, escaped
labels, Unicode folding/scalar label length, escaped spaces, type-7 raw tag
exclusion and leaf nesting depth. The buffer test originally exhausted `work`
on later content rather than rejecting the earlier reference-buffer overflow;
the expanded-tab-line test originally resolved instead of rejecting `text`.
Both now reject their intended ceilings.

Coverage includes indentation and partial/full tabs, lazy/missing container
markers, tight/loose and nested lists, interruption, ordered starts of 0/1/other
and nine/ten digits, empty items, fences with conflicting length/characters,
raw info strings, unclosed fences, whitespace, CRLF/EOF, thematic/setext/list
ambiguity, all HTML block categories, definitions and original source points.

The normative CommonMark 0.31.2 specification was read independently at
https://raw.githubusercontent.com/commonmark/commonmark-spec/0.31.2/spec.txt.
This corrected an erroneous original test expectation about angle destinations:
spaces are valid inside angle brackets. The malformed-destination case now
uses an unescaped nested `<`; a separate case accepts spaces. Reading the
specification is not an execution of the full upstream conformance corpus.

Unicode folding exceptions derive from licensed Unicode 17.0.0 default C/F
folding data at https://www.unicode.org/Public/17.0.0/ucd/CaseFolding.txt,
SHA-256 `ff8d8fefbf123574205085d6714c36149eb946d717a0c585c27f0f4ef58c4183`.
The static table supplements locale-independent ECMAScript lowercase and
includes the Unicode copyright/permission notice. No Unicode data is fetched
at runtime or by unit tests.

## Maintained checks

- `npm run test --workspace=@poe-code/pandoc`: 7 files, 319 tests passed;
  block-phase suite 113 tests, approximately 22 ms in the final run.
- `npm run lint --workspace=@poe-code/pandoc`: passed ESLint and both maintained
  source/test TypeScript checks.
- `npm run build:workspaces -- --workspace=@poe-code/pandoc`: passed the
  declaration-derived selected build closure, one Pandoc build.

No UI or active command behavior changed; no visual CLI validation is claimed.
No full repository, release, native-oracle or complete upstream corpus gate is
claimed. No push or release was requested or performed.

Verified source SHA-256:

- parser: `e50421becd68b0b4705d38c9702aeeb528a663cb02b4e8d95d4fea39d83a16dc`
- tests: `06cd12f516b1a15700a29d6665d5ff219bb13beff1c66ae8b7ec1110fb9a2d9c`
- case-fold table: `14da5457d4ea22cbce9d962543b006900f00b4aba98628aba6604f24f2a9a3e5`
