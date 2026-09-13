# Draft accessibility metadata usage

Inspect drawing metadata and structural slide-title findings:

```sh
pptx accessibility list deck.pptx --json
pptx accessibility get deck.pptx --slide 1 --shape Overview --json
pptx accessibility set deck.pptx --slide 1 --shape Overview --alt-text 'Map of the courtyard' --title 'Courtyard map' --decorative false --output described.pptx --json
```

Use exact shape names or an opaque `--select` token from inspection. Ambiguous
names fail. `--all` explicitly permits multiple matching objects; `--dry-run`
validates an edit and reports effects without publication. A package edit needs
`--output` or `--in-place`; the common output, stale-state and force rules apply.

```sh
pptx accessibility set deck.pptx --slide 1 --shape Border --decorative true --dry-run --json
pptx schema accessibility --json
pptx capabilities --json
```

Use `--scope layouts` or `--scope masters` to inspect shared owners; edit a
shared object by its emitted `--select` token. The direct SDK can also select
that owner with `scope: "shared"` and `part`.

Direct SDK operations use the same metadata engine:

```ts
import { readAccessibility, mutateAccessibility } from "pptx";

const report = await readAccessibility(bytes, { slide: 1 }, context);
const edited = await mutateAccessibility(bytes, {
  slide: 1,
  shape: "Overview",
  update: { altText: "Map of the courtyard", title: "Courtyard map", decorative: false }
}, context);
```

`context` is the explicitly configured byte/package capability and limit context.
The edit returns bytes for caller-controlled publication. Set descriptions using SDK `altText` or CLI `--alt-text`; `description` is
an inspected output field, not an accepted accessibility update key. Both `description` and `altText` in inspected records
represent the same drawing description. Empty strings are explicit metadata.
Omitted update fields preserve their values.

The report separates objects from slide-title diagnostics. Drawing metadata
`title` does not create or change the text of a title placeholder. A missing
slide title means no nonempty title-placeholder text was found; duplicates are
structural title-text findings using exact, case-sensitive comparison after
trimming boundary whitespace across all slides. Review these findings in the presentation's
context before deciding to change content.

Objects include structural order and per-field source provenance. Missing local
placeholder metadata can fall back to layout metadata under the documented
structural policy; an explicit empty value stays local. This does not prove
which metadata a renderer or assistive technology uses. Shared image occurrences
retain independent descriptions because the metadata belongs to each drawing.

These checks do not certify accessibility or measure contrast, visual reading
order, rendered layout or screen-reader behavior. Returned records are inspection
snapshots; they do not implement a live shape-model API.
