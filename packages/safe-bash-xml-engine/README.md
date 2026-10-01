# Bounded XML processing

Safe Bash shares XML tree queries, serialization, input decoding and resource
budgets between its XML commands. The engine uses the canonical safe-fs XML
parser and preserves UTF-8 admission, cancellation and explicit limits. Resource
quotas default to `Infinity`; configure finite byte, depth, node, attribute,
namespace, work or result limits as needed. Explicit `Infinity` disables a quota.

Access XML functionality through `@poe-platform/safe-bash/commands/xml` and its
`xmlCommands` plugin. This private engine is bundled into the public package;
it requires no separate installation and has no external runtime dependency.

XML input also respects the shell execution input-byte limit for stdin and files.
XPath supports the built-in `xml:` prefix (for example, `/root/@xml:lang`).
Other query prefixes resolve through namespace declarations on the document root;
matching uses namespace URIs, so aliases for the same URI select the same nodes.
Unprefixed names select nodes with no namespace. Use
`//*[local-name()="item"]` to select elements regardless of namespace.
