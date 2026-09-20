# Original TypeScript RTF reader

`readDocument(input, {from: "rtf"}, context)` accepts byte input. The existing
`createPandocCommand` delegates `-f rtf` to the same reader; it invokes no native
converter, external executable, object handler or field evaluator. RTF output is
still unavailable. The profile follows the RTF section of `contract.md`.

## Supported profile

Only Windows-1252 (`ansi`, `ansicpg1252`) and UTF-8 (`ansicpg65001`) are supported.
The default is Windows-1252, never a UTF-8 guess. Font charsets 0 and 1 inherit
the document page; explicit font `cpg` must also be 1252 or 65001. Other pages,
charsets and `mac`/`pc`/`pca` fail with `E_ENCODING`. Contiguous raw/hex byte runs
are decoded together, so UTF-8 sequences can cross escaped-byte boundaries.
UTF-8 BOM characters in text runs are preserved, not document-normalized.

The byte tokenizer distinguishes groups, words, symbols, signed parameters,
hex escapes and opaque `bin` blocks. Words have at most 32 letters and parameters
fit signed 32-bit integers. Every binary count is validated against remaining
bytes before advancing, including inside noncontent destinations. Braces and
backslashes in binary blocks have no structural meaning.

Run state and paragraph properties restore at group boundaries. Signed 16-bit
`u` controls produce UTF-16 units with paired surrogate validation. Scoped `uc`
controls determine fallback units; raw bytes, hex escapes, symbols, words and
opaque binary blocks are skipped lexically. A group boundary ends pending
fallback skipping. Raw CR/LF outside binary blocks are lexical whitespace.

| RTF feature | AST representation |
| --- | --- |
| Paragraphs, line/tab controls | Para, LineBreak, Space |
| Bold, italic, underline, strike, small caps, super/subscript | Typed inline wrappers |
| Flat/grouped font tables, explicit/default font, size, color table | Span attributes `font-family`, `font-size`, `color` |
| Paragraph/character styles and inherited styles | Scoped formatting; cyclic inheritance fails |
| Outline levels 0–8, body level 9 | Header levels 1–9, Para |
| Alignment and indents in twips | Div attributes `text-align`, `margin-left`, `margin-right`, `text-indent` with point values |
| Modern lists and start/format overrides; legacy pn lists | OrderedList or BulletList with nesting |
| Decimal, Roman, alphabetic numbering; period/parentheses | Typed list style and delimiter; unsupported labels fail |
| Inert HYPERLINK fields, URL/local bookmark | Link with formatted result |
| Footnotes | Note with independently scoped blocks |
| Rectangular rows/cells, multiple cell paragraphs | Table with explicit cells and rows |
| PNG/JPEG hex or binary pictures, including shppict wrapper | Image plus owned resource bytes |

Pictures require an encoding signature; the reader retains the encoded bytes
without executing a decoder or claiming complete PNG/JPEG validation. PNG/JPEG
are the only supported picture encodings. Dimensions must be positive and at
most 100,000 each; their product must fit the caller's `layoutWork` budget.

Known noncontent `info` and `generator` destinations may be omitted. Unknown
words/destinations, including starred destinations, fail strictly with
`E_CAPABILITY`. Embedded objects/OLE/fonts, drawings, active field instructions,
headers/footers, nested footnotes, table merges, changing table geometry,
unsupported list labels and malformed field extras never disappear silently.
Active fields fail; their result is not substituted for the unsupported field.
No read-specific environment variables or options were added. Existing context
limits apply to work, nesting, references, retained text/bytes, fonts, images,
binary bytes, table shape and final AST/resources. Limits can only be lowered.

Font/color/alignment/indent attributes are preserved as AST data. Existing writers
which cannot represent them reject them or use their established explicit loss
policy; this reader does not broaden writer styling support.

## Verification evidence (2026-09-16)

All cases are original, covering the behavioral areas named by Readers.RTF and
test/rtf; no upstream fixture or implementation was copied. Before implementation
29 of the initial 34 RTF cases failed on the absent reader. Additional original
tests first exposed legacy numbering, default fonts, scoped Unicode settings,
text-bearing destinations, paragraph resets in cells, and unknown constructs in
font/style/list definitions, then passed after their fixes.

- `npm test --workspace=@poe-code/pandoc`: 25 files, 821 tests passed, including
  68 RTF cases. The memfs operand test checks SDK/command parity, output mutation
  and strict diagnostic failure. Unit tests use no host file mutations, external
  executables, downloaded fixtures or LLM calls.
- `npm run lint --workspace=@poe-code/pandoc`: passed ESLint and source/test
  typechecks.
- `npm run build:workspaces -- --workspace=@poe-code/pandoc`: passed the maintained
  selected workspace build (one build in the derived workspace graph).
- `rtf-command.png`: captured and visually inspected the built thin command's
  GFM heading/run output and strict unknown-destination diagnostic. The screenshot
  renderer lacks the emoji glyph; the original byte/AST tests verify the surrogate
  output as U+1F600. No CLI design-system change was made.

This is scoped package verification, not full native-Pandoc differential
qualification or application interoperability certification. The existing
`primary-specifications.json` records that RTF 1.9.1 primary-source retrieval was
unsuccessful; no new specification hash or verified primary bytes are claimed.
