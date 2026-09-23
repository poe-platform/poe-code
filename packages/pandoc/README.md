# @poe-code/pandoc

Private document-conversion workspace. Applications use the published
`poe-code/pandoc` entry; explicit shell registration is exposed by
`poe-code/safe-bash/commands/pandoc`.

```ts
import { convert } from "poe-code/pandoc";

const result = await convert(
  [{ bytes: new TextEncoder().encode("# Hello\n") }],
  { from: "commonmark", to: "plain" },
  {}
);
```

The SDK exposes `convert`, `readDocument`, `writeDocument`, `inspectFormats`,
`formatCapabilities`, and `PandocError`. Inspect format capabilities before
conversion: support is format-specific and does not imply full native Pandoc
compatibility. Office engines load when their formats are selected.
Plain output uses link labels, spaces for soft breaks, four-column decimal list
prefixes, 72-character rules, and a final newline even for empty documents.
Bullet lists use the compact spacing of Pandoc 3.11.
Shell arguments accept `--read`/`-r` and `--write`/`-w` as format aliases,
attached short values such as `-fcommonmark -thtml -ooutput.html`, and bare
`-M draft` or `--metadata=draft` as boolean true. `-v` reports the same
TypeScript converter identity as `--version`.

## Configuration

`ConversionOptions` requires `from` and `to`. Writer options are `yes` (explicit
metadata defaults), `standalone`, `metadata`, `metadataJson` (ordered maps; null
deletes keys), `metadataFiles` (explicit JSON inputs), `rawContent` (`reject`,
`escape`, or `retain`), `lossy`, and `failIfWarnings`. Plain output accepts
`wrap` (`none`, `auto`, or `preserve`) and positive `columns` (default 72 when
wrapping is requested); other wrapping writers, including HTML and JSON, accept `none`. HTML accepts
`numberSections`, `toc` (linked contents in standalone output, through level 3),
and `ascii` (numeric entities). `shiftHeadingLevelBy` (−6 through 6) adjusts
headings, `stripComments` removes raw HTML comments while preserving code, and
`eol` (`lf`, `crlf`, or portable `native` = LF) selects text line endings.
The command exposes the corresponding hyphenated flags and accepts
`--standalone=false`. These options extend the bounded writers; they do not
imply upstream template or complete writer equivalence.

Resources use `resourcePath` (ordered VFS directories) and `extractMedia` (VFS
output directory). No media is downloaded implicitly. PDF options are `pdf`
(`pageSize`: `a4` or `letter`; `orientation`: `portrait` or `landscape`; `margin`,
`font`, `fontSize`, `lineHeight`), `pdfPage` (`width`, `height`, `margin`, in points),
and `pdfFonts` (ordered supplied font inputs). The packaged named font is `mono`;
other named families are unsupported. EPUB options are `epub.title`,
`epub.language`, `epub.identifier`, and `epub.chapterLevel` (1–6).

`ConversionContext` accepts `resourceFiles`, `resourceCwd`, `resources`, `reader`,
`writer`, `output`, `signal`, `yield`, and `limits`. Output supports atomic
publication or an explicitly supplied streaming destination; streaming output
can remain partial after failure. Inputs contain `bytes` or `chunks`, with
optional `source` and `base`.

`limits` can lower the exported `defaultLimits` ceilings: `inputBytes`,
`resourceBytes`, `outputBytes`, `nodes`, `depth`, `work`, `retainedBytes`, `text`,
`attributes`, `tableCells`, `tableFieldText`, `tableRows`, `tableColumns`,
`resources`, `diagnostics`, `references`, `entities`, `entityBytes`,
`compressedBytes`, `expandedBytes`, `parts`, `xmlDepth`, `xmlNodes`, `binaryBytes`,
`macros`, `includes`, `directives`, `fonts`, `glyphs`, `pages`, `objects`, `images`,
and `layoutWork`. See [the exported types](src/types.ts) for adapter contracts.

## Environment variables

The runtime exposes no environment variables. The RST development conformance
runner accepts `PANDOC_DOCUTILS_PYTHON` to select its Python executable (default:
`python3`).

## Development

Run `npm run build --workspace=@poe-code/pandoc`,
`npm run typecheck --workspace=@poe-code/pandoc`, or
`npm run test:unit --workspace=@poe-code/pandoc` from the repository root.
