# DOCX usage

`docx` is a private TypeScript ESM workspace for document inspection and editing.
It has no standalone executable. See the [package README](../../packages/docx/README.md),
[proposed contract](../specs/docx.md), and [test index](acceptance-matrix.md).

## Discover operations

```js
import { parseDocxArguments, getDocxDiscovery } from "docx";

const encode = value => new TextEncoder().encode(value);
const invocation = parseDocxArguments(["schema", "text", "replace"].map(encode));
console.log(getDocxDiscovery(invocation).data);
```

Arguments are byte arrays. Generated `help` and `schema` describe the current
operation fields; a declared operation is not proof that every document variant
can be edited. Capabilities distinguish inspection, editing, preservation, and
rejection.

## Register the command

Import `docxCommands` from `@poe-platform/safe-bash/commands/docx` and explicitly
register it on a Safe Bash `Shell`. Supply an engine created with
`createDocxInspectionCommandEngine({ limits, documentLimits })` from `docx`.
The host provides filesystem and stream capabilities and may set resource limits.
DOCX is not enabled by the default command preset.

Within that registered shell:

```sh
docx inspect draft.docx --json
docx schema text replace
docx text replace draft.docx --find Draft --with Final --first --dry-run
docx revisions list draft.docx
docx images list draft.docx
```

Selections belong to a particular document state. Reacquire locations after
mutation; stale or cross-document selections must not authorize edits. Mutation
options control output, in-place publication, overwrite, and dry-run behavior.
Use each operation's schema for its exact required arguments and defaults.

## Host limits and publication

`ArchiveContext` supplies an abort `signal`, optional `limits`, and an optional budget.
Resources are unlimited unless configured. Each field is optional; setting one
leaves other resources unlimited. The default I/O chunk size is 65536 bytes.
Archive limits cover archive/entry/total bytes, member count, paths, depth, extra
fields, comments, retained bytes, and chunk size. `documentLimits` bounds document
work, XML structure, retained state, serialization, and diagnostics. Its names are
`compressedInput`, `expandedPackage`, `zipEntries`, `xmlPartBytes`, `xmlNodes`,
`xmlDepth`, `embeddedMediaBytes`, `retainedBytes`, `serializedOutput`,
`batchOperations`, `matches`, `insertedNodes`, `tableCells`, `tableRows`,
`tableColumns`, `diagnosticBytes`, and `work`.

CLI `--limit NAME=VALUE` and SDK overrides can raise or lower an earlier setting.
Separate explicit archive and document bounds still apply together. SDK ceilings
accept `Infinity`; chunk sizes remain finite. One invocation shares its budget
across acquisition, parsing, edits, and publication. Accounting is conservative
and does not measure process memory. Capabilities reports finite effective limits;
resources omitted from that list are unlimited.

The host must explicitly supply filesystem and publication authority. Document
relationships and embedded content do not grant network or native-process access.
Edits preserve unrelated parts and reject affected structures whose semantics are
unsupported. Publication is staged so a failed edit does not replace the destination.

The utility does not paginate or render Word documents, execute fields or embedded
objects, or recompute cached page numbers. No product environment variables are
required. `DOCX_SCHEMA_ROOT` is used only by optional independent schema tests.
