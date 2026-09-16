# Paragraph formatting

Paragraph operations address logical paragraphs in deterministic text-body order.
`text paragraphs list`, `get` and `set` share the common scoped selectors, JSON
envelope, output controls and exit statuses. Formatting edits preserve existing
runs, breaks, fields and their character formatting. They do not measure text or
calculate line wrapping.

SDK operation lengths are points. Command lengths require explicit units, such
as `12pt`, `0.25in` or `3mm`, and are converted before calling the same operation.
`lineSpacing` distinguishes `{ "unit": "pt", "value": 18 }` from
`{ "unit": "multiple", "value": 1.5 }`. XML stores spacing in centipoints
(100 per point), multiples in 100,000ths and paragraph margins, indentation and
tab positions in EMUs (12,700 per point). Conversion is bounded and deterministic.
A numeric zero is an explicit value; it is never treated as an omitted option.

`alignment` accepts left, center, right, justify, justifyLow, distributed and
thaiDistributed. Paragraph `marginLeft`, `marginRight`, `indent` and
`defaultTabSize` use points. `spaceBefore` and `spaceAfter` use points. `level`
is zero-based from 0 through 8. `rtl` controls paragraph direction without
reversing character content or calculating the rendered list marker.

A bullet is an explicit choice: none, a single Unicode scalar character, or
numbered with a numbering scheme and optional starting number. Tabs are ordered
records with a point position and left, center, right or decimal alignment.
Neither list numbering nor tab metadata is a layout engine.

An omitted option preserves existing XML. A nullable option set to `null`
removes only its local override so inherited defaults can apply again. Explicit
empty tabs and no-bullet choices suppress their corresponding inherited
behavior. Local snapshots distinguish absent values from defaults; a local
snapshot is not the same as an effective inherited-style query. Existing
percentage before/after spacing is preserved when omitted and has no absolute
point value in the local point-only getter.

The neutral object-model spellings `alignment`, `level`, `line_spacing`,
`space_before` and `space_after` remain the public model contract. Operation
camelCase keys are a separate command/SDK surface. A model line-spacing value
is `Length | number | null`; only `Length` has `.pt`. JavaScript numeric property
lookup yields `undefined`, and null dereference raises the native TypeError.
Neither behavior is converted into an invented model-property exception.

The [case accounting](paragraph-formatting-case-map.json) enumerates all 40
relevant expanded unit rows, 22 BDD examples and 30 paragraph/alignment API rows.
Rows distinguish executable value evidence from remaining model obligations;
these counts are not a claim of complete public API coverage. The broader
paragraph interface also includes runs, font, text, clear, run/break insertion
and owning-part access, which remain visible even when outside this formatting
change. All serializable alignment enum symbols, the mixed return sentinel,
the alias and conversion/validation helpers have original executable evidence.

`PP_ALIGN` and `PP_PARAGRAPH_ALIGNMENT` are the same numeric enum object.
`from_xml(token)`, `to_xml(value)` and `validate(value)` provide bounded
conversion. Numeric JavaScript enum values have no instance fields:
`PP_ALIGN.metadata(value)` supplies frozen `name`, `value` and `xml_value`
metadata. `MIXED` has a null XML value and cannot be serialized or assigned.
This explicit mapping preserves existing numeric symbols while preventing
mutable conversion definitions.

`new Length(emu)`, `new Emu(value)`, `new Inches(value)`, `new Cm(value)`,
`new Mm(value)`, `new Pt(value)` and `new Centipoints(value)` create immutable
lengths. Each exposes `.emu`, `.inches`, `.cm`, `.mm`, `.pt` and `.centipoints`.
Values round once to safe integer EMUs, with halfway cases away from zero;
`.centipoints` floors division, including negative values. The separate
[length accounting](length-case-map.json) records all 13 source variants and
56 constructor/inherited-accessor API records. No ambient I/O is involved.

The current `Paragraph` facade owns an explicitly supplied bounded paragraph XML
view. It is not yet a live paragraph returned from a complete presentation
object graph. Given such a facade, formatting uses direct model properties:

```ts
import { Paragraph, Length, Pt, PP_ALIGN } from "pptx";

function formatParagraph(paragraph: Paragraph): void {
  paragraph.alignment = PP_ALIGN.CENTER;
  paragraph.level = 2;
  paragraph.line_spacing = new Pt(20);
  paragraph.space_before = new Pt(0);
  paragraph.space_after = new Pt(6);

  const spacing = paragraph.line_spacing;
  if (spacing instanceof Length) {
    console.log(spacing.pt); // 20
  }
  paragraph.line_spacing = 1.5;
  paragraph.space_after = null;
}

PP_ALIGN.to_xml(PP_ALIGN.CENTER); // "ctr"
PP_ALIGN.metadata(PP_ALIGN.CENTER); // { name: "CENTER", value: 2, xml_value: "ctr" }
```

For package edits, use `mutateTextParagraphs(input, options, context)` or the
matching command engine route; those perform admission, selection, validation
and package serialization through the shared engine. Direct facade mutation
changes its `.xml` view and does not independently publish a package.
