# XML validation and XPath

Use xmllint through Safe Bash to validate UTF-8 XML, format documents, canonicalize
XML, or select nodes and scalar values with bounded XPath queries.

```ts
import { Shell, createMemoryFileSystem } from '@poe-platform/safe-bash';
import { xmlCommands } from '@poe-platform/safe-bash/commands/xml';

const shell = new Shell({ fs: createMemoryFileSystem() }).use(xmlCommands());
const result = await shell.exec("xmllint --xpath 'count(/root/item)'", {
  stdin: new TextEncoder().encode('<root><item/><item/></root>')
});
await shell.dispose();
```

Standalone `createXmllintCommand()` and `createXmllintCommands()` factories use
the same default runtime as `xmllintCommands()`. XPath functions work both at
the top level and inside predicates: `concat`, `contains`, `starts-with`,
`substring`, `substring-before`, `substring-after`, `translate`, `string-length`,
`normalize-space`, `string`, `count`, `name`, `local-name`, `namespace-uri`,
`not`, `boolean`, `true`, `false`, `sum`, `number`, `floor`, `ceiling`,
and `round`. Predicates also support comparisons, `and`, `or`, and positions.

Supported modes include `--noout`, `--format`, `--c14n`, `--exc-c14n`,
and `--xpath`. Use `--noblanks` to remove ignorable whitespace before queries
or serialization, `--nocdata` to serialize CDATA as escaped text, and `--output FILE` / `-o FILE` to write serialized XML to
the virtual filesystem. File output streams into retained staging when the filesystem
supports guarded atomic publication, preserving existing file identity and aliases.
Other backends use a 64 KiB caller-backed spool and replay after serialization and
output-budget admission, with that backend's normal write guarantees. `--recover` repairs truncated elements, mismatched end
tags, and undeclared entities, reporting repairs on stderr. `--encode ENCODING`
selects UTF-8, UTF-16 (including LE/BE), US-ASCII, or ISO-8859-1 output. Inputs come
from stdin or one or more files in the configured virtual filesystem. Normal input
is decoded and parsed incrementally. `--noout` without XPath discards the document
tree. Formatting and canonicalization, including `--noblanks` and `--encode`, keep document nodes in a 1 MiB
page cache and spill through the supplied filesystem under `TMPDIR` or the working
directory. Large workloads need an external filesystem backend; a memory filesystem
still stores spilled bytes in RAM. Ordinary XPath uses stored nodes and paged
selection sets for predicates and unions. `--nocdata` and `--noblanks` transform
stored nodes for formatting and XPath; adjacent text fragments remain backed by
the filesystem. `--recover` uses the same paged document storage and a separate 64 KiB
caller-backed cache for normalized input and linked parser frames, including with
`--noout`. XPath string
functions use paged code-point values and replay scalar output in chunks. Formatting
and canonicalization store pending traversal frames in the same page cache. Individual XML tokens and
ordinary-parser ancestry and individual namespace scopes remain resident, so this is not yet a bounded-memory guarantee
for arbitrary documents or queries. Files are
processed in order; malformed files report an error while later files continue.
XPath output remains enabled with `--noout` or `--format`. When writing multiple
documents with `--output`, each document replaces the destination. XML limits
are shared across all files in an invocation and bound input, output,
query bytes, depth, nodes, attributes, namespaces, steps and results. The XML
plugin accepts explicit limit overrides and replacement registration.
DTD/external entities and unsupported XPath syntax are refused. This internal
workspace ships inside the existing Safe Bash bundle; install and import the
public package, without installing this workspace separately.

The workspace entrypoint exports `xmllintCommands()` for plugin registration,
`createXmllintCommands()` for the command collection, and
`createXmllintCommand()` for a single command. Use `xmllintCommand` for a
ready-to-register command with default options. Each factory accepts an optional
`XmllintCommandsOptions` object; existing factory names remain available.
The default runtime reads virtual files and stdin, handles cancellation, and
uses the configured XML limits. The optional runtime argument remains supported.
