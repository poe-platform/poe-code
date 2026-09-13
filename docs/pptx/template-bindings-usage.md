# Typed template bindings

Draft usage for the bounded `template.apply` operation. Bindings are literal data.
Each entry explicitly names its slide scope, one-based slide and cardinality.

```json
[
  {
    "kind": "text",
    "name": "heading",
    "scope": "slides",
    "slide": 1,
    "cardinality": "one",
    "text": "Quarterly review — 東京"
  },
  {
    "kind": "table",
    "name": "totals",
    "scope": "slides",
    "slide": 1,
    "cardinality": "one",
    "table": [["Region", "Total"], ["North", "42"]]
  }
]
```

Put `{{heading}}` in slide text. Name the target table shape `{{totals}}` and
supply exactly its existing row and column count. The table must be unmerged,
and each cell must contain one paragraph with ordinary text runs, without fields,
breaks or equations. An image binding instead uses
`"kind":"image"` and `"image":{"bytes":[...],"contentType":"image/png"}`,
with actual admitted PNG, JPEG or GIF bytes; name its picture shape `{{name}}`.
There is no path or URL lookup inside an image binding.

```ts
import { applyTemplateBindings } from "pptx";

const result = await applyTemplateBindings(inputBytes, bindings, context);
const outputBytes = result.bytes;
```

```sh
pptx template apply slides.pptx --data-file bindings.json --output bound.pptx --json
pptx template apply slides.pptx --data-json '[]' --dry-run --json
pptx schema template apply
```

Use exactly one of `--data-file` and `--data-json`. Paths use the configured
virtual filesystem. The CLI invokes the same package operation as the SDK.
Normal mutation needs `--output` or `--in-place`; existing destinations need
explicit authorization through the shared output flags. Dry-run validates without
publishing. An empty binding array returns the original bytes unchanged.

Names are exact, case-sensitive strings without braces; Unicode is preserved
without normalization. `one` requires exactly one matching slot; `all` permits
repeated slots in that explicit slide. The same name can be bound independently
on another slide. Every recognized slot on a selected slide needs a declaration.
Unknown fields, missing payloads, absent slots, duplicate declarations and missing
bindings fail before publication. Literal single or unmatched braces are text.
Text inserted by a binding is never scanned again, so `{{other}}` in a supplied
value stays literal. No expressions, scripts or dotted-property lookup run.

Payload and expanded-text byte budgets count UTF-8 bytes, including multibyte
Unicode. Oversized text or table payloads fail admission before the SDK reads
the presentation; repeated replacements are bounded before editing. Serialized
XML and package output must also fit their configured limits.

Cross-run text replacements retain the first affected run's formatting and leave
unaffected runs and hyperlinks intact. Table binding retains the fixed grid and
cell formatting. Image binding changes the selected occurrence, preserving
unselected uses of shared bytes. Notes, masters, layouts and table resizing are
outside this bounded operation. For repeated-slide expansion, use the separate
[repeat object form](template-repeat-usage.md) of `template apply`.
