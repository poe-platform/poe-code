# XML utility behavior reconciliation

The [190-row ledger](xml-utility-reconciliation.json) reconciles 106 presentation utility variants and 84 explicitly selected counterpart utility variants. Every selected identity has an original observable assertion and an explicit language/validation disposition. This is utility behavior accounting, not whole-public-model parity. All domain-specific XML/BDD obligations remain in their feature ledgers; no BDD scenario directly targets these utilities.

The previous `xml-case-map.json` covered only 72 presentation rows, with broad foundational/deferred labels. Its 15 OPC XML rows now belong to the separate package reconciliation; this receipt supersedes the other 57 utility rows and adds all 49 scalar variants and 84 counterpart utility rows. The full inventory retains every source identity, including inherited and underscore-prefixed public members. Those members are governed by current owner/live-view receipts; they are neither renamed private nor counted complete by internal codec tests.

## Implemented corrections

A small internal `xml-scalars.ts` codec now parses actual drawing coordinate offsets and color brightness. Universal measures preserve all six source quantities and expected EMUs; percent literals preserve all six signed/zero/leading-zero cases. Shape SDK inspection and `shapes get` share the corrected reader, including stored left/top and projected corners. Hexadecimal and exponent integer tokens now fail. Missing or malformed brightness no longer turns into zero, hexadecimal values or NaN.

Only `off` and `chOff` use the coordinate union; `ext`/`chExt`, shape IDs and rotation attributes retain integer lexical parsing. Extent unit suffixes fail. There is no dynamic schema registration, parser callback, host I/O, native runtime or product network capability. The codec is internal, with domain logic kept in `packages/pptx`.

## Exact language and security mappings

- Numeric token admission applies the [XML Schema whitespace collapse rule](https://www.w3.org/TR/xmlschema-2/#rf-whiteSpace): only outer XML space/tab/CR/LF is removed; internal numeric whitespace and nonbreaking spaces fail. Literal and character-reference whitespace variants are tested.
- Numeric XML uses finite decimal tokens and safe integer EMUs. Unit suffixes are lowercase `in`, `mm`, `cm`, `pt`, `pc`, `pi`; invalid hex, exponent, repeated dot, empty and unsafe values fail. Conversion uses the existing JavaScript numeric arithmetic policy. Exact half values `±0.000125mm` become `±5`, deliberately using ties away from zero rather than the source runtime's ties to even. This difference is tested and does not silently claim literal runtime parity.
- The scalar helper validates lexical XML. Raw generic XML edits explicitly take strings or null. Numeric values are serialized by the caller; null removes an attribute. The source required/optional descriptor fixture invents a range `1..42` on a nonformat element. That arbitrary schema is not installed into the product. Exact `24`, `36`, `42`, null, `-4` and `"2"` cases instead assert the specified generic lexical boundary and immutable error behavior. This does not claim all real typed model attributes have been validated.
- QName records and frozen child arrays replace generated class instances, string subclasses and property descriptors. Original child order, cardinality states, standalone namespace validity and exact edited bytes are asserted. The six search, five insertion and eleven repeated-removal variants remain separately expanded.
- Original whitespace, attribute order, namespace declarations and Unicode bytes survive reads. This intentionally differs from whitespace stripping, pretty printing and the source test-only permissive XML line comparator. All five line-shape variants and six comparison categories have original structural equivalents; incomplete and unbound fragments fail. No arbitrary XPath or dynamic callback is exposed.
- Runtime docstrings, mock call identity and invented metaclasses map to observable QName/value results. Public model spellings remain unchanged. `InvalidXmlError`/`invalid-xml` covers malformed numeric XML, while absent direct integer lexical input uses the neutral `TypeError`/`invalid-type` contract.

## Evidence

Original fast cases: `xml-scalars.test.ts` (64), `xml-utility-reconciliation.test.ts` (87), and `command-xml-scalars.test.ts` (1). Existing XML preservation, font color, shape command and live XML tests supplement these focused assertions. Unit tests use strings or memfs and contain no downloaded binaries or reference-project identities.

TDD recorded 19 initial scalar failures, then a separate SDK shape-reader failure, an overpermissive extent regression, and a native error-category regression. All were reproduced before their respective fixes. Root inspected the maintained command screenshot `/tmp/pptx-utility-scalars.png`: `Measured RECTANGLE`, successful exit, clean fit. The JSON/SDK test independently asserts numeric output. The [plan](../plans/pptx-xml-utility-reconciliation.md) records QA procedure; root records final maintained package checks and local delivery.

Required standalone research/license notices remain intact. Tests and implementation use original wording and original in-memory assets; no source code or binary asset was copied.
