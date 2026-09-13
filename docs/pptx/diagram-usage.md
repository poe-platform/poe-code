# Diagram inventory draft

The current package SDK exposes read-only diagram resources through:

```typescript
const result = await readSelectionIndex(inputBytes, context);
const resources = result.inventory.diagrams;
```

`inputBytes` is an admitted `Uint8Array`; `context` supplies the existing byte,
archive, XML and relationship limits. The SDK has no implicit host I/O.

The configured command exposes the same records:

```text
pptx inspect presentation.pptx --json
pptx schema inspect
pptx capabilities
```

Read `data.inventory.diagrams` in the inspection result. Each record includes the
part name, resource kind (`data`, `layout`, `style`, `colors`, or `drawing`), direct
relationship owners, all reachable existing internal dependencies, missing
internal target names, and `semanticEditing: false`. Dependency lists exclude
the resource itself even when a cycle points back to it. External targets are
metadata only; the utility never fetches them.

Shared resources appear once with multiple owners. A drawing fallback can appear
without a data model. Package inventory remains package-wide when selectors
narrow inspection records; it is not a count of visible diagram occurrences.

This preserves and describes existing appearance resources. There is no diagram
layout engine, diagram text/node editor or automatic regeneration of fallbacks.
A diagram inventory record does not expose a semantic editable shape model.
Missing dependencies are inspection evidence, not repaired content. Import must
have a complete required relationship closure before it can publish.

The examples describe workspace APIs and configured command access, not a public
registry release. No README change is implied.

Import selected slides with their original diagram appearance resources:

```typescript
const outputBytes = await importSlides(
  destinationBytes,
  sourceBytes,
  { sourceSlides: [1, 2] },
  context
);
```

```text
pptx slides import destination.pptx --source source.pptx --source-slides '[1,2]' --theme-policy source --output imported.pptx
```

Import copies shared dependencies once and relocates relationship targets while
retaining resource payload bytes and local diagram identities. Both supported
choice and raster fallback branches are retained. Shape IDs may repeat across
exclusive branches, but duplicates within one branch fail. Incomplete graph
edges and unsupported dependencies fail before publication; import does not
repair, relayout or regenerate a diagram.
