# Bounded XML processing

Safe Bash shares XML tree queries, serialization, input decoding and resource
budgets between its XML commands. The engine uses the canonical safe-fs XML
parser and preserves UTF-8 admission, cancellation and explicit limits. Resource
quotas default to `Infinity`; configure finite byte, depth, node, attribute,
namespace, work or result limits as needed. Explicit `Infinity` disables a quota.

Access XML functionality through `@poe-platform/safe-bash/commands/xml` and its
`xmlCommands` plugin. This private engine is bundled into the public package;
it requires no separate installation and has no external runtime dependency.

The input decoder exposes an incremental string stream for XML parsers; callers
that explicitly need a complete string can use its buffering convenience API.
Incremental decoding preserves borrowed input bytes and consumer backpressure.
For formatting and canonicalization, the stored document model writes node metadata
and sibling links into the caller's safe-fs page store. Serialization walks sibling
links incrementally instead of collecting them in an array. The default cache is
1 MiB; individual XML tokens and namespace scopes still have their own memory cost. Use an external filesystem
backend for large workloads, since a memory backend retains its backing bytes in RAM.
Stored XPath uses ordered, paged node references for selections, predicates and unions;
small selection caches hold at most 128 references. It reads node metadata on demand
and walks subtrees through stored parent/sibling links. Text, CDATA, comment and processing-instruction bodies use bounded fragments
while keeping each logical node and its serialization delimiters intact.
Text entity references are decoded directly from bounded source windows. XML
declarations retain only normalized version, encoding and standalone fields, so
large declaration whitespace does not inflate document metadata.
Whitespace removal and CDATA
conversion update those links; coalesced text stays in replayable token fragments.
Input and linked parser frames share a separate 64 KiB caller-backed cache.
Ordinary parsing requests at most 512 UTF-16 units at a time, accepting short chunks
so limits and cancellation can stop the producer immediately. Recovery first
validates normalized input, then replays 4 KiB windows through the same parser.
Only the current frame is cached by the parser. Source and frame backing retire
before output; no complete source string is assembled. Individual frame metadata
still scales with attribute and namespace scope size.
XPath string functions use a fixed small-value cache and paged code points for
larger values. Searches and large translation maps also use caller-backed storage;
scalar output replays bounded chunks. Individual parser tokens and namespace scopes
still need bounded storage before arbitrary documents can be qualified.

XML input also respects the shell execution input-byte limit for stdin and files.
XPath scalar expressions and predicates support unary negation, addition, and subtraction.
XPath supports the built-in `xml:` prefix (for example, `/root/@xml:lang`).
Other query prefixes resolve through namespace declarations on the document root;
matching uses namespace URIs, so aliases for the same URI select the same nodes.
Unprefixed names select nodes with no namespace. Use
`//*[local-name()="item"]` to select elements regardless of namespace.

Stored formatting and canonicalization also place pending traversal frames in the
caller-backed page store. Canonical namespace validation follows stored tree links;
indentation is emitted in fixed windows. Individual namespace
metadata/tokens still require separate memory qualification.

`storedXmlToJson` streams the xmltodict mapping from a `StoredXmlDocument`, using
paged repeated-name groups and traversal tasks. The legacy `xmlToJson` convenience
API still returns a complete JSON value. Downstream query engines own their value
storage independently.
