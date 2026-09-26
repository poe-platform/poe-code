# htmlq: select and extract inert HTML

Select elements with CSS selectors and extract HTML, descendant text or attributes.
SVG/MathML namespaces and attribute insertion order are preserved.
I/O uses byte streams and the configured VFS only. There is no script execution,
host executable/filesystem access, network access, native/WASM fallback, dynamic
download or external runtime dependency.
Use Node.js 22+ with TypeScript ESM. Browser/workerd conditional imports and
declarations are checked in Node; actual browser/workerd engines remain unqualified.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { htmlqCommands } from "@poe-platform/safe-bash/commands/htmlq";

const fs = createMemoryFileSystem();
await fs.writeFile("/input.html", new TextEncoder().encode("<p>Hello <b>world</b></p>"));
const shell = new Shell({ fs });
shell.use(htmlqCommands());
const result = await shell.exec("htmlq p -t -f /input.html"); // Hello world + LF
await shell.dispose();
```

| API | Purpose |
| --- | --- |
| `htmlqCommands(options)` | Opt-in shell registration; `replace` is explicit |
| `htmlq(context, options)` | SDK execution with typed projection/path options or literal `argv`, and identical VFS behavior |
| `htmlqBytes(source, argv, options)` | Source-only SDK producing bounded UTF-8 chunks; paths require command context |
| `selectHtml(node, selector, options)` | Compile selectors and lazily visit matching engine-owned elements |
| `parseHtmlqArguments(argv, options)` | Shared CLI/SDK argument validation |
| `parseHtml(source, options)` | Lossy UTF-8 decoding, tokenization and bounded document construction |
| `serializeHtml(node, options, mode)` | Normalized HTML, or original decoded source for an unchanged document |
| `serializeHtmlBytes(node, options, mode)` | Bounded UTF-8 output with consumer backpressure |
| `htmlText(node, options)` | Concatenate descendant text, including inert scripts/styles |
| `inclusiveHtmlDescendants(node, options)` | Live inclusive traversal; queue the next edge before yielding |
| `detachHtmlNode(node, options)` | Repair parent/sibling links and invalidate original-source serialization |

Engine and source-only calls require explicit `limits` and `signal`; command
calls use the context signal and optional resource limits. SDK calls accept
`selector`, `filename`, `output`, `base`, `detectBase`, `text`, `ignoreWhitespace`,
`pretty`, `attributes`, `removeNodes`, `help` and `version`, or `argv`; combining both forms fails.
Omitted SDK operands use context argv; specifying typed options uses the same
CLI defaults. For example, `htmlq(context, { selector: "p", text: true })`
reads context stdin and writes text to context stdout. Sources must yield
`Uint8Array` chunks and implement prompt `return()` cleanup if they can block;
pass the same signal to any external producer. Input admission precedes decoding.
Limits cover input bytes, decoded UTF-16 bytes, conservative allocation admission (`retainedBytes`), created
nodes/attributes, stack depth, token UTF-16 storage, work and output UTF-8 bytes.
Errors identify their code and resource. Producer failures propagate and source
cleanup is awaited; byte-output failures remain observable by the consumer.
If input and cleanup both fail, an `AggregateError` preserves both failures in
that order, including falsey thrown values. Depth counts edges from the document
and includes implied nodes and the separate template fragment.
DOM properties and ordered attribute/child arrays are read-only at runtime.
Template contents are separate fragments and excluded from ordinary traversal,
text and serialization, matching the pinned native engine.

The bounded parser supports tested HTML recovery, entities, raw text, tables,
formatting reconstruction and foreign integration points.
`htmlqBaseline.fullHtml5Parity` is **false**: complete HTML5 parsing/recovery
has not been qualified against html5ever. This engine is not a browser DOM.
The command supports selector lists; descendant, child, adjacent and general
sibling combinators; type, ID, class and attributes (`=`, `~=`, `|=`, `^=`, `$=`,
`*=` and `i`/`s` flags); `:scope/:root/:empty`, nonnested `:not`, structural
first/last/only and nth child/of-type predicates. HTML names use ASCII case
folding; classes split only on CSS ASCII whitespace. `:link/:any-link` match
HTML links with href, including empty href. Browser state predicates parse but
always return false. Modern `:is/:where/:has/:lang`, nested `:not`, pseudo-elements
and named namespace prefixes are explicitly rejected. Complete selectors 0.22.0
grammar, Rust URL normalization and every pretty writer state remain open.

CLI examples (paths refer only to the configured VFS):

```sh
htmlq p -t -f /input.html               # descendant text, one final LF per result
htmlq a --attributes href -f /input.html # present href values, one LF each
htmlq div -r span -f /input.html -o /selected.html
htmlq --help                           # usage and supported options
htmlq --version                        # safe-bash implementation and compatibility profile
```

| Supported flag | Value / behavior |
| --- | --- |
| `-f`, `--filename` | VFS input path; default `-` reads stdin |
| `-o`, `--output` | VFS output path; default `-` writes stdout |
| `-b`, `--base` | Base URL for inert link rewriting |
| `-B`, `--detect-base` | Detect the document's first base href |
| `-t`, `--text` | Descendant text projection |
| `-i`, `--ignore-whitespace` | Skip whitespace-only text nodes |
| `-p`, `--pretty` | Stateful pretty HTML projection |
| `-a`, `--attributes` | Attribute name; repeatable |
| `-r`, `--remove-nodes` | Removal selector; repeatable |
| `-h`, `--help` | Print help without reading HTML or accessing VFS paths |
| `-V`, `--version` | Print the compatibility version and virtual implementation identity |

Short flags can be grouped (`-tip`); short value options accept attached values
(`-aid`, `-a=id`). Long value options accept `=VALUE`.
The optional selector defaults to `html`; input/output default to `-`.
Unknown flags (including `--attribute`), abbreviations
and extra positional operands fail. `--` ends option parsing.
Help and version return status 0 without reading stdin or accessing VFS paths,
including when `-f` or `-o` is present. The first help/version flag ends option
parsing; invalid options before it still fail. The SDK accepts `{ help: true }`
or `{ version: true }`, and `htmlqBytes` supports the same literal flags without
consuming its source. Output limits and cancellation still apply. Version output
identifies the compatibility profile, not a native htmlq runtime.
Only attributes and removal selectors are repeatable during HTML processing;
repeating other processing options fails with argument status 2, including mixed
short/long spellings and grouped flags.
Separate option values cannot begin with a dash except the stdin/output sentinel `-`;
use attached values for literal leading-dash paths. Typed SDK values remain literal.
Attributes override text, which overrides pretty HTML. Present attributes emit their decoded value and LF;
missing attributes emit nothing. Text concatenates descendant nodes then adds
one LF per selected result. With `-i`, whitespace-only text nodes are skipped,
and each retained text node gets LF before the final result LF. HTML serializes
the selected element itself and adds LF. No matches succeed with empty output.
Script/style/noscript content stays inert and preserved; templates omit their
separate content fragment from selection, text and serialization.

Removal detaches the first inclusive match of comma-joined removal selectors
per selected node. Queries remain live: detaching an already queued node can
truncate later selection. Invalid removal selectors are ignored. Rewriting
only changes the selected HTML a/area/link href. A valid first detected base wins
over explicit base; an invalid first base falls back to explicit base. `////`
hrefs lose all leading slashes; invalid joins substitute the base. URLs remain
inert data, including javascript URLs, and are never fetched or sanitized.

Command limits default to `Infinity`. Set finite input, decoded, retained,
node, attribute, depth, token, work or output limits as needed; explicit
`Infinity` disables that quota. The result includes cumulative
accounting; depth/token values are high-water bounds. Allocation accounting is
conservative cumulative admission, not a measurement of live heap bytes.
Standalone engine calls own separate budgets; one behavior/command invocation
shares its ledger across parsing, matching, mutations and projections.
Output files require atomic conditional VFS publication or byte mutation;
byte-only providers use bounded spooling before commit. Input is fully read
before publication, including same/aliased input/output; failed projections do
not publish partial files. stdout streams can expose an admitted prefix before
failure. Status is 0 for success, 2 for argument errors and 1 for engine/VFS
errors. Diagnostics are bounded code-only `htmlq: E_*` lines when budget permits;
if exhausted, the structured error remains available without a diagnostic.
Sink/source and cancellation failures propagate; cleanup failures are retained.

Original mode preserves complete lossy-decoded source spelling, including BOMs
and line endings; it does not reconstruct source slices for selected nodes and
rejects mutated documents. Normalized parsing strips U+FEFF only at document
start and retains interior BOMs under every byte chunking, deliberately correcting
the pinned tokenizer's feed-boundary defect.

The research baseline is mgdm/htmlq commit
`bfcb1d1d11a80fdd92c0dace1e7e559fbdb225cb` (0.5.0), with kuchikiki 0.8.2,
html5ever 0.26.0 and selectors 0.22.0. Native research controls qualify only
enumerated cases; none of those libraries is a product runtime dependency.

This package is private and ships only through
`@poe-platform/safe-bash/commands/htmlq`. It is never independently published.

CLI informational flags are also available through SDK `help: true`, `version: true`,
and `htmlqBytes` argv. They write to stdout regardless of `--output`.
