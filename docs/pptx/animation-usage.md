# Animation inventory draft usage

`pptx animations list slides.pptx --json` reads slide timing structure without
executing animations or media. Sequence/parallel nodes, effects, trigger metadata,
target shape IDs, timing IDs, references and motion-path strings remain visible.

```sh
pptx animations list slides.pptx --json
pptx animations get slides.pptx --slide 1 --json
pptx animations list slides.pptx --slide 1 --shape 'Overview clip' --json
pptx schema animations list --json
pptx capabilities --json
```

`get` requires one selected slide graph; a deck containing several selected slides
is ambiguous even if only one has timing. Shape selection requires `--slide` and
retains the complete containing graph when the shape is targeted. It does not
isolate an effect or discard siblings. `--select` accepts an emitted selector and
cannot be combined with simple selectors. Scope is `slides`; notes and master
scopes are not accepted. `--limit NAME=VALUE` lowers declared resource budgets.
Listing accepts no mutation or output-file flags. Expanded timing-reference destinations per slide also obey the XML node budget.

The SDK uses `await readAnimations(input, { selection }, context)`, or `{}` to
read all slides. Input is supplied bytes or an explicit byte/VFS capability;
context supplies byte, archive, XML and relationship limits. For example, using
already admitted input and a caller-provided context:

```ts
const records = await readAnimations(
  input,
  {
    selection: {
      kind: "slide",
      scope: "slides",
      position: { coordinateSystem: "one-based", value: 1 }
    }
  },
  context
);
```

Each SDK record contains its owning slide/part/location, root IDs, nodes,
diagnostics, target shape IDs and `xml` (standalone timing-root markup). Nodes expose `id`, `parentId`, `children`,
`namespace`, `type`, `kind`, nullable `timingId`, `targetShapeId`, `effectType`,
`triggerType`, `mediaInteraction` and `motionPath`, plus raw attributes and timing
references. Structural node IDs are separate from potentially duplicated document
timing IDs. Output follows slide order and XML preorder. Repeated target IDs are
deduplicated in first-occurrence order. An empty slide still has an SDK record
with no timing nodes. `executionVerified` is always false.

The CLI uses the common version-1 envelope with operation `animations.list` or
`animations.get`, `affected: 0`, and `data.items` containing one item per timing
node. Each item has `location`, `kind`, `name` and typed `fields`. String/null/list
values use `{type, value}` wrappers. Attribute tuples contain namespace, local
name and value; reference tuples contain a timing ID and resolved node IDs.
Diagnostics are attached to the first node of each graph as code/reference/node-ID
list tuples. Root nodes carry their standalone markup in the nullable `xml` field; child nodes carry null. Empty graphs emit no items. Envelope locations still identify the
selected slides. Missing targets, duplicate IDs, unresolved/ambiguous timing
references and cycles are inventory diagnostics; inspection does not repair them.

Complex timelines, unknown extensions, media commands and motion paths remain
inert metadata. No elapsed-time calculation, playback, link opening, rendering,
retargeting or animation editing is provided by these reads. Resource exhaustion
fails with exit 4, missing/ambiguous/stale selections and invalid documents with exit 1, invalid selector arguments or flags with
exit 2, I/O with exit 3 and cancellation with exit 130. Use the generated schema
for the precise wire representation and permitted options.
