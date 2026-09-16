# Independent pptx assertion helpers

`packages/pptx/tests/assertions.ts` provides test-only checks over an expanded
package in a memfs `Volume`. Pass `{ volume, root }`; paths are relative to that
root. No ZIP, SDK, CLI, filesystem default or environment configuration is exposed.
These helpers are not part of the shipped public API.

| Helper                                               | Independent expected input                               | Check                                                                                                                                        |
| ---------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `assertPartHashes(deck, expected)`                   | Part path → SHA-256 hex                                  | Exact bytes for every specified part; missing parts fail.                                                                                    |
| `assertRelationships(deck, owner, expected)`         | Array of `{ id, type, target, external }`                | Exact owner-local edges, unique IDs and existing internal target files. Order is immaterial. Empty owner selects package-root relationships. |
| `assertSlideOrder(deck, presentationPart, expected)` | Ordered `{ id, relationshipId, part }` array             | Presentation list order and resolved slide targets, with unique IDs and relationships.                                                       |
| `assertInheritedProperties(deck, sites, expected)`   | Nearest-first XML sites; `{ values, effective, source }` | Exact raw values including absence at each site, first present value and supplying part.                                                     |
| `assertResourceOccurrences(deck, owners, expected)`  | Owner parts and resource part → occurrence count         | Embedded image references across explicit owners; different resource parts stay distinct even when their bytes match.                        |

For inheritance, a site has `part`, `path` and `attribute`. Each path component
and attribute is `{ namespace, localName }`. The path starts at the XML root and
uses direct children; an absent node/attribute yields null, ambiguity fails.
Caller-selected sites encode the intended inheritance order. The helper does not
resolve placeholders, themes or relationships. Empty string and `"0"` are present
raw values, not absence. `source` is the supplying part or null.

Declare expected results in the test independently of the producer. Do not build
expected values by reading the writer's own model. For example, a test with two
pictures on one slide and one picture on another, all sharing one media part,
uses the literal count below:

```ts
assertResourceOccurrences(deck, ["ppt/slides/first.xml", "ppt/slides/second.xml"], {
  "ppt/media/tile.bmp": 3
});
```

Resource counting traverses embedded DrawingML blips in the supplied owners,
including nested content. It requires internal image relationships and target
files. Linked images are rejected; MCE branch selection, image decoding and
visual occurrence/fidelity are outside its scope. Choose owners explicitly;
duplicate owners fail. Owners without blips need no relationship part.

Relationship/slide helpers use Transitional XML and simple authored part paths.
They are assertions for tiny trusted in-memory fixtures, not URI-security or
schema validators. Hashes check only the listed parts, not a complete inventory.
The helper tests use independent authored XML, fixed bytes and deliberate
corruptions. Existing original deck fixtures can also be passed directly.

Validation procedure and limitations are recorded in
[the milestone plan](../plans/pptx-independent-assertions.md).
