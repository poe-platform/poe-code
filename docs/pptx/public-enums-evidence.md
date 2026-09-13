# Public enumeration evidence

The reconciled API inventory identifies 25 enum definitions, 716 member records
(including equal-valued aliases) and 13 documented definition aliases. The original
acceptance table covers 698 numeric symbols, 15 action symbols and the three OLE
application symbols. Every XML-enabled definition has a per-value conversion
case (575 cases); these include inherited conversion helpers without dedicated
reference unit cases. The behavioral file adds strict-input, alias-identity,
immutability, sparse numeric and metadata cases. These tests import production
modules directly and perform no filesystem, runtime or network operations.

## Implementation and JS mapping

- Existing numeric model symbols remain numeric; `metadata(value)` supplies the
  immutable `name`, `value` and, when applicable, `xml_value` record. The typed
  numeric union or enum remains the target argument type. This explicit accessor
  maps scalar-member metadata without wrapping numbers or changing live setters. Primitive numeric members do
  not expose `.name` directly. New numeric enum definitions preserve distinct
  TypeScript enum types even when underlying numbers overlap.
- Action symbols retain their existing immutable `{name,value}` objects. OLE
  application values are immutable objects with `name`, `value`, `progId`,
  `width`, `height` and `icon_filename`. Dimensions are Length values. Icon names
  are neutral identifiers, not host paths; this enum work does not introduce an
  OLE insertion method or promise a bundled icon asset.
- Definition aliases share object identity. Equal-valued language aliases retain
  both property names. Media `OTHER` and `SOUND` retain their documented collision.
- XML conversion compares exact strings and numeric values, never coerces
  booleans, null or numeric strings, and returns the first declared matching
  value for duplicate XML tokens. Consequently XML round trips can canonicalize
  duplicate callout or language tokens; they cannot recover lost identity.
- Under J04, empty XML tokens and return-only sentinels map to immutable null
  metadata and fail conversion/validation with a value error. There is no implicit
  fallback XML. Numeric zero remains distinct: data-label ABOVE and underline
  NONE convert normally where their tokens are nonempty.
- Drawing helper methods are non-enumerable so existing symbol iteration/count
  remains unchanged. All new definitions and metadata are frozen.
- `PERCENT_40` is the documented spelling, value 6 and token `pct40`; no typo
  alias is introduced. `SLIDE_IMAGE` remains exposed. Inspection availability
  does not enlarge chart creation capabilities.

The original tests first failed because language-enum.ts and ole-enum.ts were
absent. Existing drawing tests then caught enumerable helper leakage; using
non-enumerable methods preserves their original symbol-only contract.

New modules: enum-definition.ts, language-enum.ts, chart-enums.ts, color-enums.ts,
media-enum.ts and ole-enum.ts. Existing drawing and underline enum definitions are
extended in place; existing shape category gains its documented MSO alias.

This is enum-surface evidence, not a claim that every model or CLI public member
in the complete inventory has been implemented. No downloaded artifacts or
publisher test implementation were copied into product or tests.

Focused enum and integration checks: five files, 1,420 tests pass. Package lint
(type checks plus ESLint) is verified by the coordinator before commit.

## Final integration validation

`npm test --workspace=pptx`: 201 files, 5,903 tests passed.
`npm run lint --workspace=pptx`: ESLint, source and test TypeScript passed.
`npm run build:workspaces -- --workspace=pptx`: selected dependency closure passed.
These checks ran on the working tree, including preserved unrelated changes;
they do not claim whole-public-API completion.
