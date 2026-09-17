# Original TypeScript conversion contract

`convert` resolves reader and writer capabilities and validates options before
acquiring document inputs. It owns and normalizes input bytes, reads typed ASTs,
validates/merges documents, applies metadata, validates the transformed AST, and
serializes before publishing output. No native runtime fallback is present.

## Operands and sources

CommonMark and GFM join operands in supplied order. Each operand independently
normalizes UTF-8 BOM and CR/CRLF, then receives a final newline if absent, including
empty operands. No extra blank-line separator is inserted. References span the
joined text; the first definition wins under the reader's existing contract.
All joined operands must share the same explicit resource `base` (including an
omitted base). Reader line diagnostics map back to the original `source` and line.
Writer diagnostics retain paths into the final AST.

CSV/TSV explicitly compose independently read tables as ordered AST documents.
Their headers and references remain local to each operand. Other descriptors,
including JSON and binary formats, accept at most one input. No JSON/binary
concatenation or resource-ID merge is inferred. Zero operands produce an empty
document; an empty JSON operand still fails JSON parsing. All operand acquisition
precedes reader calls; a later reader failure prevents writer/publication calls.

## Metadata

Precedence, lowest to highest: document metadata in operand order, explicit
`metadataFiles` in order, parsed `metadataJson` objects in order, typed `metadata`.
MetaMaps/JSON objects recursively merge; later arrays/lists and scalars replace
earlier values. JSON null deletes an object key. Null list elements are rejected
because the AST has no null metadata constructor. Booleans become MetaBool;
strings and finite numbers become MetaString; lists/maps become MetaList/MetaMap.
Typed metadata nodes are validated before input acquisition. Unsafe keys are
rejected. Independent document collisions produce ordered, bounded
W_METADATA_CONFLICT diagnostics; explicit option overrides are intentional.

Metadata files are strict JSON objects, with token/depth/work admission before
object materialization. Comments, trailing commas and empty files are rejected.
Duplicate JSON object keys follow JSON.parse's last-value precedence. Named files
must use `.json`; YAML is rejected. No defaults file or environment options are
read. Metadata changes parsed objects; no source text or regex editing is used.

## Command mapping

The opt-in command supports explicit `-f`/`--from`, `-t`/`--to`, `--wrap=none`,
`--lossy`, `-s`/`--standalone`, `--raw-content=reject|escape|retain`, and
`--fail-if-warnings`. Single-value/boolean options cannot repeat. The converter
also checks format applicability; unsupported combinations fail before input.

`-M KEY=VALUE`, `-MKEY:VALUE`, and `--metadata[=]KEY=VALUE` accept text, or JSON
values beginning with `{`, `[`, or a quote, plus true/false/null. Repeated metadata
assignments merge in order with later values winning. Malformed JSON values fail.
Repeated `--metadata-file[=]PATH` files are read in order, before CLI assignments,
regardless of their positions among arguments.

File operands require the invocation's injected `readFile(path, signal)` callback.
No operands means stdin; explicit `-` supplies stdin once among ordered operands.
`--` admits subsequent literal filenames. CLI filenames provide source identity;
no resource base is inferred from ambient working directories or filenames.
`-o`/`--output` requires one destination and injected `writeFile(path, bytes, signal)`;
the callback must honor the SDK atomic-publication contract. Otherwise output uses
the invocation stdout sink. SDK applications instead supply explicit InputSources
and output/resource capabilities directly.

Filters, Lua, citeproc, arbitrary templates, external PDF engine flags, variables,
styles/includes and unknown flags are rejected before input/resource/output
acquisition. Inspection remains available through the maintained list commands.

Warnings from reading, merging and writing are retained in stable encounter order.
`failIfWarnings` rejects with E_WARNINGS before output publication or streaming
destination acquisition/cleanup. Parse errors preserve format/source location;
destination failures remain E_IO and cancellation remains E_CANCELLED. Command
cancellation and opaque stdout/stderr failures continue to escape to the host.

## Verification

Original failing fixtures reproduced joining, JSON admission, deep metadata merge,
warning preflight, later reader locations, joined source locations, SDK metadata
admission and streaming destination cleanup gaps before implementation.

Maintained package checks: 594 unit tests passed across 19 files;
`npm run lint --workspace=@poe-code/pandoc` passed including source/test typechecks;
`npm run build:workspaces -- --workspace=@poe-code/pandoc` passed. File mutation
fixtures use memfs; unit fixtures use no host scratch files, external executables,
downloaded data or LLMs. Scope is the pandoc workspace, with no safe-bash runtime
changes or claim of full native Pandoc parity.

The accompanying orchestration-cli.png captures actual compiled command output
for standalone conversion, warning rejection and unsupported Lua rejection.
