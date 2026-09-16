# Live XML view evidence

The ten additive J09 `XmlElementView` members in public-api-map.json now have an
original implementation over the existing `XmlPart` engine. This is a bounded
view receipt, not whole-object coverage or complete dependency-API compatibility.

| Public member       | JavaScript mapping and original acceptance                                                                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tag`               | Frozen `{ namespace, localName }`, independent of source prefix spelling                                                                                               |
| `attrib`            | Frozen ordered attribute array with frozen qualified names; namespace declarations are excluded                                                                        |
| `children`          | Frozen ordered membership snapshot of owned element handles; comments/text are not element children                                                                    |
| `get(name)`         | Qualified namespace/local-name lookup, exact string value or null for absence                                                                                          |
| `set(name, value)`  | Existing structured merge handles escaped strings, namespace binding creation and null attribute removal                                                               |
| `text` read         | Decoded text/CDATA before the first child element; null for empty/absent text. Entity decoding occurs in the existing parser, never a second parser                    |
| `text` write        | String or null; null writes empty leaf content. Existing leaf setter rejects children, comments and processing instructions rather than destroying them                |
| `append` / `insert` | Move a live same-part owned node, retaining standalone namespace bindings; zero-based index from 0 through child count, with destination adjusted after source removal |
| `remove`            | Remove exactly one owned direct element child                                                                                                                          |
| `replace`           | Replace one direct child by moving another same-part element; moving a node onto itself is a no-op                                                                     |

Moves never clone relationships or allocate detached public XML editors. Foreign
owners, invalid indexes, ancestor cycles and nonchild removals/replacements fail.
All changes use `XmlPart` merge/splice/text operations and its existing immutable
reparse, retaining byte/node/depth ceilings, XML admission and lexical preservation.
Graph validation is the mandatory owner commit boundary: the candidate is passed
to the owner with the expected prior document, and view state advances only when
that commit succeeds. The view itself cannot publish package bytes or bypass the
owning package's graph validation. Integration tests must cover the concrete
package owner separately.

A successfully mutating receiver is refreshed; previously acquired other handles
fail with `invalid-handle` after the owner's document identity changes. Failed
validation/limit edits leave the receiver and owner bytes intact. Readonly arrays
are snapshots, not mutation channels. There is no XPath/eval, arbitrary loader,
external entity resolver, path access, network or host process capability.

These view members are deliberate language/security mappings for public
`.element` access, including documented underscore-prefixed returned interfaces.
They do not classify those interfaces as private. Dependency-specific XML class
factories/descriptors remain distinct private implementation machinery; this
receipt does not change their inventory disposition or erase unsupported public
APIs.

Validation: initial focused test collection failed because the view module was
absent. Following implementation, 8 original in-memory view tests and 67 existing
XML engine/subtree cases pass (75 total). Tests do not access a filesystem, so no
memfs filesystem setup is needed. Cases cover every member, attribute namespace
creation/deletion, Unicode/escaping, namespace-preserving moves, destination path
adjustment, stale/foreign/cycle errors, byte/depth limits and failed owner commit
atomicity. No downloaded or cloned fixture was used or removed.
