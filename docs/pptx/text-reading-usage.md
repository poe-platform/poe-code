# Structured text extraction

The local private `pptx` workspace exports
`readPresentationText(input, options, context): Promise<PresentationText>`.
Inputs are admitted bytes, an explicit byte source, or a capability-scoped VFS
path. Context supplies byte, archive, XML and relationship limits and optional
cancellation. No host path, external link, clock or font discovery is implicit.
Options are `scope`, `select` (the existing `SelectionQuery`) and `shape` (an
exact nonempty name requiring one explicit selected slide). Unknown options fail.

```typescript
import { readPresentationText } from "pptx";

const result = await readPresentationText(bytes, {}, context);
const notes = await readPresentationText(bytes, {
  scope: "notes",
  select: { kind: "slide", position: { coordinateSystem: "one-based", value: 2 } }
}, context);
```

The registered safe-bash command uses the same extractor:

```sh
pptx text deck.pptx
pptx text get deck.pptx --slide 2 --shape Caption --json
pptx text deck.pptx --scope notes --slide 2 --json
pptx text deck.pptx --scope layouts --json
pptx text deck.pptx --scope masters --json
pptx schema text get --json
pptx capabilities --json
```

Default scope is `slides`. Explicit drawing scopes are `notes`, `layouts`,
`masters`, `notes-master` and `handout-master`. Selection tokens retain owning
scope and presentation fingerprint; stale or ambiguous selections fail. The
command schema lists supported option combinations. Fine-grained table, cell,
paragraph and run selectors remain unavailable in this milestone.
Notes-master and handout-master scopes do not accept a slide selector.

`PresentationText` contains `text`, `order: "structural"`, and `segments`.
Segments identify their owning shape with a fingerprinted `location`, carry
`paragraphs`, and include zero-based `cell` coordinates for table text. Paragraphs
have zero-based indexes, text, and ordered `inlines`:

- `{ kind: "run", text }` preserves ordinary text, including empty strings.
- `{ kind: "break", text: "\u000b" }` identifies a soft break.
- `{ kind: "field", cachedText, fieldId, fieldType }` preserves cached field
  text; absent field metadata is `null`. Fields are never evaluated.

Flat text joins paragraphs and segments with U+000A and retains soft breaks as
U+000B. Empty paragraphs, runs and field caches remain distinguishable in JSON.
Plain command output is the exact flat text, with no synthetic final newline.
JSON uses the common version-1 `text.get` envelope and reports `affected: 0`.

Traversal follows slide-list order, depth-first shape-tree order, row-major table
cells and paragraph/inline XML order. Hidden slides participate. Equal strings
and repeated placeholder keys do not collapse separate shapes. Shared layout
and master parts appear once per selected scope, with slide-associated parts
first and remaining parts afterward. This is structural order, not visual reading
order. Reading does not create missing notes or change package bytes.

This operation does not implement the live `Presentation`, `TextFrame`,
`_Paragraph`, `_Run` or `_Cell` model. Whole-text assignment, preserving text
replacement, chart text and complete public-model coverage remain separate work.
The compiled command schema describes implemented support; the full command
register retains proposed options and batch operations.
