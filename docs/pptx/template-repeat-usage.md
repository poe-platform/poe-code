# Repeating designated template slides

Draft usage for the `template.apply` repeat operation. Supply explicit prototype
positions, ordered records and a media policy:

```json
{
  "kind": "repeat",
  "slides": [2],
  "mediaPolicy": "shared-media",
  "records": [
    [{"kind":"text","name":"heading","scope":"slides","slide":2,"cardinality":"one","text":"Coastal survey"}],
    [{"kind":"text","name":"heading","scope":"slides","slide":2,"cardinality":"one","text":"Mountain survey"}]
  ]
}
```

Place `{{heading}}` in the second source slide. Both records address original
slide 2. The result replaces that prototype with two independently bound slides.
For multiple prototypes, each record emits the requested slide order at the first
selected source position. For example, selecting `[3, 1]` with two records emits
record 1's slide 3, record 1's slide 1, record 2's slide 3, record 2's slide 1,
then the remaining source slide 2. An empty `records` array removes the selected
prototypes. An empty record can repeat a prototype without slots.

```ts
import { applyTemplateRepeat } from "pptx";

const result = await applyTemplateRepeat(inputBytes, repeatOptions, context);
const outputBytes = result.bytes;
```

```sh
pptx template apply slides.pptx --data-file records.json --output expanded.pptx --json
pptx template apply slides.pptx --data-file records.json --dry-run --json
pptx schema template apply
pptx capabilities --json
```

Use exactly one of `--data-file` and `--data-json`. File paths use the configured
virtual filesystem. Normal mutation requires `--output` or `--in-place`; existing
destinations follow the common explicit overwrite rules. Dry-run performs
validation without publication. A later invalid record fails the entire operation
and leaves the destination unchanged.

Choose `shared-media` to permit reused source media parts or `isolated-instance`
to copy media per repeated slide graph. Layouts, masters and themes remain shared under both policies. The policy is required. Graph copying also
handles the supported notes, charts and timing references; an unsafe dependency
fails visibly. Sharing does not authorize an image binding to change an unrelated
occurrence. The complete expanded output and all records share the configured
limits.

Text, table and image records retain [the existing literal binding rules](template-bindings-usage.md).
Binding slide numbers always name selected original prototypes. Every recognized
slot on a bound prototype requires its declaration. Text is literal, including
braces in replacement values; there are no scripts, expressions or property-path
lookups. Notes/master text is not a binding scope. Use the original plain array
form when binding existing slides without repetition.

For copying without replacing prototypes, use
`pptx slides duplicate slides.pptx --slide 2 --position 3 --media-policy isolated-instance --output copy.pptx`.
The matching SDK `duplicateSlides` option is `mediaPolicy`; omission on this
lower-level copy operation retains `shared-media` for compatibility.

The low-level `applyTemplateBindings(input, bindings, context, selectedSlides)`
accepts an optional fourth array for validating slots on additional original
slide positions, even when their bindings are absent. It defaults to `[]`, which
uses binding-derived scope. Repeat invokes this scope check for every prototype.
Plain-array CLI input retains binding-derived scope; the explicit repeat object
is the command route that validates all designated prototypes.
