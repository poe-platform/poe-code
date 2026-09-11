# XML queries

The default `agentCommands()` preset includes `xq` and `xmllint`. Both read one
UTF-8 XML document from the supplied virtual filesystem or stdin:

```sh
xq '/catalog/book[@available="yes"]/title' /catalog.xml
xmllint --xpath 'count(/catalog/book)' /catalog.xml
xq 'string(/catalog/book[1]/title)' -
```

These commands implement a bounded XPath subset. `xq` uses this XPath syntax;
it does not implement the jq-based XML tools that also use that command name.
There is no host filesystem fallback or external entity resolution.

## SDK configuration

```ts
import { Shell, createMemoryFileSystem, agentCommands } from "@poe-platform/safe-bash";

const fs = createMemoryFileSystem();
await fs.writeFile("/catalog.xml", new TextEncoder().encode(
  "<catalog><book><title>Example</title></book></catalog>",
));
const shell = new Shell({ fs }).use(agentCommands({
  xml: { limits: { maxInputBytes: 1024 * 1024, maxResults: 100 } },
}));
try {
  const result = await shell.exec("xq 'string(/catalog/book/title)' /catalog.xml");
  console.log(result.stdout); // Example followed by a newline
} finally {
  await shell.dispose();
}
```

For separate registration, import `xmlCommands`, `createXmlCommands`, and
`defaultXmlQueryLimits` from `@poe-platform/safe-bash/commands/xml`. The same exports
are available from the package root. `xmlCommands({ replace, limits })` installs
both commands; `createXmlCommands({ limits })` returns their definitions.
`replace` defaults to false. The aggregate preset uses its top-level replacement
policy, so the `xml` option of `agentCommands` accepts only `limits`. No environment variables
configure this family.

## Supported expressions

- Absolute child paths (`/catalog/book`) and descendant paths (`//book`).
- ASCII unprefixed names and `*`. Names match the empty namespace; wildcards
  also match namespaced elements, including Unicode names.
- Terminal attributes (`/@id`, `/@*`) and text (`/text()`). Namespace declarations
  are excluded from `@*`.
- Positive positional predicates (`[1]`) and attribute equality
  (`[@id='first']`). Predicates apply in written order, with positions per parent.
- Outer `string(PATH)`, `count(PATH)`, and `boolean(PATH)`.

Results are deduplicated in document order. Element results serialize XML;
node results each end with a newline. Scalars also end with a newline.
`string()` uses the first selected node, including descendant text for elements.

Unsupported expressions fail before reading input. These include `/` alone,
namespace prefixes, explicit axes, union, arithmetic, variables, relative paths,
and other functions. Multiple input files and unrelated xmllint flags are
unsupported. XML input, query arguments, and filenames must be valid UTF-8;
XML declarations must agree with UTF-8. DTDs, DOCTYPE, external entities, unknown
entities, malformed namespaces, and malformed XML are rejected.

## Limits and outcomes

All `limits` values are positive safe integers. Configuration is copied when
creating the commands. The default limits are independent:

| Option | Default | Bounds |
| --- | ---: | --- |
| `maxInputBytes` | 8,388,608 | Input bytes; also filename byte admission |
| `maxOutputBytes` | 8,388,608 | Emitted result bytes |
| `maxSourceBytes` | 65,536 | XPath argument bytes |
| `maxDepth` | 64 | Element depth; configurable maximum 256 |
| `maxNodes` | 100,000 | Retained elements, attributes, and content nodes |
| `maxAttributes` | 10,000 | Total attributes |
| `maxAttributesPerElement` | 128 | Attributes on one element |
| `maxNamespaces` | 256 | Namespace bindings in one scope |
| `maxSteps` | 1,000,000 | Charged input, parsing, traversal, and serialization work |
| `maxResults` | 100,000 | Selected results after predicates at each path step |

A document below the byte cap may exceed another cap. In particular, scanning
and repeated traversal consume work; the input cap does not promise that an
8 MiB document fits the default work budget. Parsing is iterative and yields
cooperatively during scanning and evaluation. Cancellation preserves the supplied
abort reason, but cannot force an uncooperative filesystem operation to stop.
Output honors sink backpressure. A late output limit or cancellation can leave
partial output already written.

| Exit status | Meaning |
| --- | --- |
| 0 | Success, including an empty scalar string, zero count, or false boolean |
| 1 | Invalid XML, encoding, or filesystem input failure |
| 2 | Invalid command arguments |
| 5 | Configured resource limit exceeded |
| 10 | Invalid or unsupported XPath |
| 11 | Empty node set |

This is an explicit xmllint-style profile. Native xmllint versions differ;
libxml2 2.9.13, for example, uses status 10 for an empty set.
