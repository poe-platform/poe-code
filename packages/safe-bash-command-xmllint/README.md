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

Supported modes include `--noout`, `--format`, `--c14n`, and `--xpath`. Inputs come
from stdin or the configured virtual filesystem. XML limits bound input, output,
query bytes, depth, nodes, attributes, namespaces, steps and results. The XML
plugin accepts explicit limit overrides and replacement registration.
DTD/external entities and unsupported XPath syntax are refused. This internal
workspace ships inside the existing Safe Bash bundle; install and import the
public package, without installing this workspace separately.

The workspace entrypoint exports `xmllintCommands()` for plugin registration,
`createXmllintCommands()` for the command collection, and
`createXmllintCommand()` for a single command. Each accepts an optional
`XmllintCommandsOptions` object; existing factory names remain available.
The default runtime reads virtual files and stdin, handles cancellation, and
uses the configured XML limits. The optional runtime argument remains supported.
