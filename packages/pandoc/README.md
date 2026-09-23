# @poe-code/pandoc

Private document-conversion workspace. Within this repository, import
`@poe-code/pandoc`; explicit shell registration is exposed by
`@poe-platform/safe-bash/commands/pandoc`. These entries are not included in the
published `poe-code` package.

```ts
import { convert } from "@poe-code/pandoc";

const result = await convert(
  [{ bytes: new TextEncoder().encode("# Hello\n") }],
  { from: "commonmark", to: "plain" },
  {}
);
```

The SDK exposes `convert`, `readDocument`, `writeDocument`, `inspectFormats`,
`inspectCommand`, `formatCapabilities`, and `PandocError`. Inspect format
capabilities before conversion: support is format-specific and does not imply full native Pandoc
compatibility. Office engines load when their formats are selected.
Plain output uses link labels, spaces for soft breaks, four-column decimal list
prefixes, 72-character rules, and a final newline even for empty documents.
Bullet lists use the compact spacing of Pandoc 3.11.
Shell arguments accept `--read`/`-r` and `--write`/`-w` as format aliases,
attached short values such as `-fcommonmark -thtml -ooutput.html`, and bare
`-M draft` or `--metadata=draft` as boolean true. `-v` reports the same
TypeScript converter identity as `--version`.
`inspectCommand(args)` and the shell command also inspect bundled Pandoc 3.11
assets: `--list-highlight-languages`, `--list-highlight-styles`,
`--print-highlight-style STYLE` (all eight listed styles),
`-D html` / `--print-default-template=html5`, and
`--print-default-data-file=abbreviations` (also `templates/default.html5`).
These static assets do not enable template conversion or syntax highlighting.
Other templates/data files are unavailable; inspection never reads user files.
`--completion=bash` and `--bash-completion` emit Bash completion for the
TypeScript converter's supported options and configured format registry.

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
imply complete native writer equivalence.

Local HTML templates use `template` (an `InputSource`) and `variables` (a JSON
map), with `$body$`, `$name$`, `$$`, `$if(name)$…$else$…$endif$`, and
`$for(name)$…$endfor$`. Partials, map interpolation, loop separators and other
template expressions are rejected. `includeInHeader`, `includeBeforeBody`, and
`includeAfterBody` accept ordered `InputSource` arrays; includes imply standalone
HTML unless a custom template is supplied. The corresponding flags are
`--template`, `--variable`/`-V`, `--variable-json`, `--include-in-header`/`-H`,
`--include-before-body`/`-B`, and `--include-after-body`/`-A`.
Short include flags accept attached paths, such as `-Hheader.html`.

`--defaults`/`-d` reads an explicitly named VFS YAML map. Use `from`/`reader` and
`to`/`writer` to select formats; explicit flags override scalar defaults.
Supported defaults cover the writer flags above, template variables, metadata,
include arrays, `input-files`, and `output-file`. Repeated defaults combine
ordered file lists and maps; unsafe execution keys and YAML aliases are refused.
`-dsettings.yaml` is also accepted. Explicit CLI operands replace `input-files`
defaults; `-` in that list reads the supplied stdin once.
SDK callers can use `resolveConversionArgs(args, files, signal, context)` with
explicit read/write callbacks, then pass its options and operands to `convert`
with the returned `limits` in the conversion context. Those remaining limits
keep defaults, templates, includes and document inputs within one budget.
`fileScope`/`--file-scope` parses document operands separately.
`sandbox`/`--sandbox` retains explicit VFS authority and never provides a native
Pandoc sandbox or additional filesystem isolation.

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

Conversion-only `filters` is an ordered list of `{kind: "json", path}`,
`{kind: "lua", path}`, or `{kind: "citeproc"}` requests. Shell equivalents are
`--filter`/`-F`, `--lua-filter`/`-L`, and `--citeproc`/`-C`.
Supply `ConversionContext.filters.apply(document, request, context)` (or the
same capability to `createPandocCommand`) to process them after metadata merges
and before writing. The callback receives the target format as `context.to`.
An optional `supports(request)` check rejects unsupported requests before any
input is acquired. Requests are snapshotted before these checks. Returned documents
are validated with the conversion limits; cancellation and callback errors prevent publication. Without an
explicit capability these requests fail `E_CAPABILITY` before input acquisition.
Paths identify requests for the trusted adapter; they never enable implicit
host execution, filesystem access, or citation support.

`createJsonFilterCapability(runtime)` adapts an explicitly supplied JSON-filter
runtime to this capability. Its `run({path, args, stdin, stdout, signal})` method
receives Pandoc JSON API `[1,23,1,2]` bytes and the base target writer name as its
sole argument (extension suffixes are removed; aliases are preserved). Await `stdout.write(bytes)` for each output chunk and return the numeric
exit status after runtime cleanup.
The runtime always receives a scoped cancellation signal: caller cancellation and
output-write failures abort it, and it closes when the runtime returns or throws.
Output is copied and charged against the shared
input/retained-byte budgets, then decoded and validated before the next filter or
writer runs. Invalid JSON, nonzero status, cancellation, and limit failures prevent
publication. Document-level resources, language, and direction stay outside the
JSON protocol and are preserved across filters. Source documents with relative
image targets are rejected because their source-directory information cannot survive
arbitrary JSON filtering. Absolute and URL image targets retain their existing writer
and resource policies. Lua uses the explicit capability below; citeproc requires
an explicitly supplied capability.

The Safe Bash plugin accepts the same capability as `pandocCommands({filters})`.
For example, with your already configured `jsonRuntime`:

```ts
import {createJsonFilterCapability} from "@poe-code/pandoc";
import {pandocCommands} from "@poe-platform/safe-bash/commands/pandoc";

const filters = createJsonFilterCapability(jsonRuntime);
shell.use(pandocCommands({filters}));
await shell.exec("pandoc -f commonmark -t html -F ./identity.py sample.md");
```

The runtime owns filter loading and execution. Registration does not grant it
filesystem or process authority, install an interpreter, or enable ambient lookup.

Local Lua `Str` filters can run in the supplied JavaScript Lua VM. Configure a
reader for trusted scripts, then pass the capability to the SDK or shell plugin:

```ts
import {createLuaFilterCapability} from "@poe-code/pandoc/lua-filters";
const filters = createLuaFilterCapability({readFile: async (path, signal) => {
  return configuredFileSystem.readFile(path, signal);
}});
await convert([{bytes: new TextEncoder().encode("Hello")}], {
  from: "commonmark", to: "html", filters: [{kind: "lua", path: "uppercase.lua"}]
}, {filters});
// uppercase.lua: function Str(el) el.text = string.upper(el.text); return el end
```

The VM exposes basic Lua, string, table, math and UTF-8 libraries and `FORMAT`.
It does not expose host filesystem/process libraries. Conversion work limits
interrupt Lua instructions. Use trusted scripts: VM allocations and library
calls are not isolated or individually metered. Only global `Str` callbacks
returning a `Str` element or nil are supported; other callbacks, Pandoc
constructors, filter tables and citeproc remain unsupported.

`createLuaFilterCapability(loadScript)` executes genuine Lua 5.3 using Fengari.
Supply an explicit `(path, signal) => Promise<Uint8Array>` loader and pass the
returned capability as `filters` in the SDK, `createPandocCommand`, or
`pandocCommands`. It supports the reported uppercase filter:

```lua
function Str(el)
  el.text = string.upper(el.text)
  return el
end
```

This profile supports only `Str` callbacks, either global or returned in a
`{Str = function(el) ... end}` table; helpers must be local. Return a Str with
string `text` and `tag = "Str"`, or nil to preserve the original. Other callbacks,
filter lists, Pandoc constructors, and citeproc are unsupported and fail explicitly.
The VM has no file, process, module-loading, or printing APIs. Basic string
operations are available; patterns, repetition, formatting, and bytecode loading
are disabled. Scripts run in a fresh VM with conversion instruction checks;
script bytes and returned text share the conversion budgets. Use trusted scripts
only: VM allocations are not isolated or bounded by the SDK retained-byte limit.

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
