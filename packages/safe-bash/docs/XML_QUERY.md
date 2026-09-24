# XML queries

The default `agentCommands()` preset includes `xq` and `xmllint`. They read
UTF-8 XML from the supplied virtual filesystem or stdin:

```sh
xq -r '.catalog.book[] | select(."@available" == "yes") | .title' /catalog.xml
xmllint --xpath 'count(/catalog/book)' /catalog.xml
xmllint --noout /catalog.xml
xmllint --format /catalog.xml
xmllint --c14n /catalog.xml
xq -r '.catalog.book[0].title' -
```

`xq` converts XML to JSON and applies the existing bounded jq interpreter,
following Python yq's xq filter interface. Element names become object keys,
attributes use `@name`, repeated siblings become arrays, empty elements become
`null`, and text is trimmed. Elements with attributes or children store their
direct text in `#text`; comments and processing instructions are omitted.
Namespace declarations are attributes and qualified names retain their prefixes.
For example, `xq .` converts `<a>text</a>` to `{"a": "text"}`.
The default filter is `.`. Multiple XML files, `-r`, `-c`, `-S`, `-s`,
`-n`, `-e`, `--arg`, `--argjson`, and `-f` use the same options as `jq`.
The jq interpreter remains bounded; Python yq's XML output, in-place editing,
force-list and streaming-depth options are unsupported and fail explicitly.

`xmllint --xpath` implements a bounded XPath subset.
`xmllint FILE` (or `xmllint -`) serializes the parsed document without indentation.
`xmllint --noout` checks well-formedness without emitting the document.
`--format` emits an XML declaration and indents element-only content with two
spaces, preserving mixed content and `xml:space` text. `--c14n` emits inclusive
Canonical XML 1.0 with comments: expanded empty elements, ordered namespaces and
attributes, normalized escaping, and no declaration or trailing newline.
`--format --c14n` removes ignorable blank text before canonicalization; `--noout`
suppresses output when combined with either mode. Supply one filename or `-`;
omitting the filename reads supplied stdin. `--` separates options from filenames.
Formatting escapes non-ASCII text and attribute values as character references
when the input declaration omits an encoding; declared UTF-8 remains UTF-8.

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
  const result = await shell.exec("xq -r '.catalog.book.title' /catalog.xml");
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

The expressions below apply to `xmllint --xpath`. Use jq filters with `xq`.

- Relative child paths, self (`.`) and parent (`..`) steps, unions (`|`), absolute child paths (`/catalog/book`) and descendant paths (`//book`).
- ASCII unprefixed names and `*`. Names match the empty namespace; wildcards
  also match namespaced elements, including Unicode names.
- Terminal attributes (`/@id`, `/@*`) and text (`/text()`). Namespace declarations
  are excluded from `@*`.
- Positive positional predicates (`[1]`, `[position()=2]`, `[last()]`), attribute
  existence/equality (`[@id]`, `[@id='first']`), child equality (`[name='first']`),
  and text equality (`[text()='first']`, `[.='first']`). Predicates apply in written order, with positions per parent.
- Outer `string(PATH)`, `count(PATH)`, and `boolean(PATH)`.

Results are deduplicated in document order. Element results serialize XML;
node results each end with a newline. Scalars also end with a newline.
`string()` uses the first selected node, including descendant text for elements.

Unsupported expressions fail before reading input. These include `/` alone,
namespace prefixes, explicit axes, arithmetic, variables,
and other functions. Multiple xmllint input files and other xmllint flags are
unsupported, including DTD/schema validation, output files, and other
canonicalization variants. Validation here means XML well-formedness, not schema
validation. The shared parser normalizes processing instructions with whitespace-only
data to an instruction without data. XML input, query arguments, and filenames must be valid UTF-8;
XML declarations must agree with UTF-8. DTDs, DOCTYPE, external entities, unknown
entities, malformed namespaces, and malformed XML are rejected.

## Limits and outcomes

All `limits` values are positive safe integers. Configuration is copied when
creating the commands. The default limits are independent:

| Option | Default | Bounds |
| --- | ---: | --- |
| `maxInputBytes` | 8,388,608 | XML input bytes across files; also argument byte admission |
| `maxOutputBytes` | 8,388,608 | Emitted result bytes |
| `maxSourceBytes` | 65,536 | XPath or jq filter bytes |
| `maxDepth` | 64 | Element depth; configurable maximum 256 |
| `maxNodes` | 100,000 | Retained elements, attributes, and content nodes |
| `maxAttributes` | 10,000 | Total attributes |
| `maxAttributesPerElement` | 128 | Attributes on one element |
| `maxNamespaces` | 256 | Namespace bindings in one scope |
| `maxSteps` | 1,000,000 | XML work; xq also bounds jq conversion and filtering independently |
| `maxResults` | 100,000 | XPath selected results or emitted jq results |

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
| 6 | Canonicalization failed because of a relative namespace URI |
| 10 | Invalid or unsupported XPath |
| 11 | Empty node set |

The status table describes `xmllint`. `xq` uses jq filter statuses (including
status 3 for invalid filters and `-e` statuses), status 1 for invalid XML,
and status 5 for resource limits. Converted JSON values also obey the existing
jq value, collection and input limits; no external jq process runs.

This is an explicit xmllint-style profile. Native xmllint versions differ;
libxml2 2.9.13, for example, uses status 10 for an empty set.
