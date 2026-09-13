# PPTX shape behavior and API mapping

Status: bounded implementation and independent coverage review; final maintained checks are recorded by root.
The [focused ledger](shapes-case-map.json) retains all 522 unit variants and 256
expanded BDD examples from the selected shape/preset/placeholder/formatting files,
plus 802 public API records. Those counts are accounting, not passing coverage.
Every exact source identity stays in research. Existing standalone research
notices remain applicable; product tests use original assets and wording.

## Language and security mappings

- Model methods/properties retain neutral spellings: `add_shape`, `add_textbox`,
  `shape_id`, `auto_shape_type`, `text_frame`, `placeholder_format`, `left`, `top`,
  `width`, `height`, `rotation`, `fill`, `line`. Operation JSON uses camelCase;
  CLI uses plural `shapes` and kebab-case flags.
- `shape_id` is a read-only local identity. It is unrelated to collection position,
  global identity, part filename or the exact name used by a CLI selector.
  Allocation must avoid IDs anywhere in the owning drawing tree.
- Plain sequences are checked zero-based model collections. CLI slide positions
  are one-based. Placeholder `idx` is a sparse key; omitted idx is zero and
  omitted type is `obj`. An explicit zero geometry value wins over inheritance.
- Lengths use safe integer EMUs. The shared conversion rounds once, halfway away
  from zero; positions may be negative, extents must be positive, line width may
  be zero. Invalid numbers do not mutate the package.
- Absence maps to `null` where allowed, never zero/false/empty. Unknown presets,
  arbitrary guide expressions and unsupported fill/line types are preserved;
  semantic writes must reject unsupported values. Creation defaults do not
  justify replacing an absent read with a synthesized explicit value.
- Getter side effects remain observable: a model text-frame or line-color getter
  may create structures; command inspection must use noncreating queries.
- Graph handles are owner-bound. Rich placeholder replacement and invalidation,
  adjustment collections, effects, gradients/patterns and all inherited members
  remain public obligations even when this bounded shape task does not expose
  them. Leading underscores never remove returned interfaces from coverage.
- No model operation discovers files, network, native rendering, fonts or time.
  Input/output admission uses explicit capabilities and existing async package
  APIs; in-memory shape property operations remain synchronous.

## Documentation drift

Operation `fill: null` and `lineColor: null` explicitly disable paint by writing
`noFill`; they do not restore inherited paint. Omitted fields preserve existing
paint. Inspection distinguishes absence using fill-kind metadata where exposed.
Restoring inherited fill is a separate public capability gap. Null title,
description and locks remove their direct attributes.

The public API register declares `shape_id` without a setter. Names remain
writable and permit an empty string. CLI selection by numeric text remains name
selection. The shared register's proposed status and the historical source audit
are not current implementation receipts: the focused ledger records exact
implemented tests separately when integration finishes.

The normative shape contract uses known presets or `text-box`; unknown geometry
is preserve-only. The broad API target includes adjustment collections, custom
paths and rich placeholder replacement, which must not be advertised as covered
by a simple preset-add operation.

## Draft usage

Common operations are `pptx shapes list`, `pptx shapes get`, `pptx shapes add` and
`pptx shapes set`, with explicit input/output and scoped selection. Consult the
executable `pptx schema` operation for the implemented preset list and exact
flags. `pptx capabilities` must identify the supported subset. The following basic workflow is exercised by the paired command tests:

```sh
pptx shapes add deck.pptx --slide 1 --kind RECTANGLE --name Card --left -1pt --top 0emu --width 2in --height 1cm --fill 1256AB --title "Card title" --locked false --output shaped.pptx
pptx shapes set shaped.pptx --slide 1 --shape Card --description "A small card" --line-color ABCDEF --line-width 2pt --output styled.pptx
pptx shapes get styled.pptx --slide 1 --shape Card --json
```

The byte SDK uses `addShape(bytes, { slide: 1, update: { kind: "OVAL",
left: new Pt(-2), top: new Pt(0), width: new Inches(2), height: new Inches(1) } },
context)` and `readShapes(bytes, { slide: 1 }, context)`. Context supplies explicit
admission and package limits. Operations return new bytes; source bytes remain
unchanged. These byte operations do not claim a complete Presentation object graph.

## Independent regression receipt

`shapes-regressions.test.ts` contains 273 original cases, including a literal
182-row preset symbol/numeric/XML table derived from reviewed enum facts in the
public API register, independently of the production table. Five geometry tokens
represent multiple numeric presets; reverse conversion uses the documented first
canonical numeric value (123, 115, 111, 119 and 137 respectively).
The final focused run passed all 273 cases in 151 ms. Four text/namespace regressions
failed before their fixes; body settings and list defaults are preserved, soft
breaks and control escapes use the text engine, and foreign namespaces reject.

`fill: "solid"` and `lineColor: "solid"` select the solid choice without
inventing black; existing solid colors are retained, while a new solid choice
has no color until an explicit six-digit value supplies RGB. Null line width
removes the direct width while `line.width` reads zero and raw inspection reads
null. `locked` addresses only `noSelect`; other lock attributes are preserved.

Text-box construction intentionally uses the original target defaults: missing
fill inherits and wrap/autofit remain unset until explicitly configured. This
differs from source-template noFill/wrap/autofit defaults and is recorded as a
target-default mapping, not exact template reproduction.

## Exact implemented enum mapping

The proposed register's EnumValue-style member properties are superseded here:
`MSO_AUTO_SHAPE_TYPE`, `PP_PLACEHOLDER_TYPE` and `MSO_SHAPE_TYPE` expose frozen
numeric literal constants; the corresponding TypeScript type is the union of
those numeric literals. `metadata(value)` returns a frozen `{name, value}` record,
plus `xml_value` for presets/placeholders. Preset XML values are strings;
return-only placeholder values use null and reject XML conversion/validation.
`MSO_SHAPE` and `PP_PLACEHOLDER` are identity-preserving export aliases. The exact
planned and actual signatures are separate fields in the focused ledger.

Every 182 preset symbol, 20 placeholder symbol and 26 category symbol now has a
literal independent case, plus alias/helper errors and metadata immutability.
The final regression file passed 273 cases in 151 ms. Full maintained package tests
passed 75 files/2178 cases in 24.42 seconds before the final 47 test-only cases;
selected build closure passed 3 builds, package lint passed, and three compiled
safe-bash consumer test files passed 89 cases. These are local check receipts,
not delivery or release receipts.

Root reran `npm run lint --workspace=pptx` after the final enum-only additions;
it passed, including TypeScript checks for the added tests.
