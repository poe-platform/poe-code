# Independent schema validation profile

This is the bounded `independent-ooxml-interoperability` research receipt.
[Execution plan](../plans/docx-independent-ooxml-interoperability.md),
[exact pins](../../packages/docx/tests/schema-pins.json) and
[per-part evidence](independent-schema-validation.json) retain the reproducible
profile and results. Product runtime validation remains the bounded
[structural/semantic profile](validation-profile.md), not an embedded XSD engine.

## Tool and scope

Independent validator: `/usr/bin/xmllint`, libxml2 **2.9.13**, reported version
`20913`. Dedicated maintained route: `npm run test:schemas --workspace=docx`,
with an explicit absolute test-only `DOCX_SCHEMA_ROOT`. It fails missing or changed
schemas/tools; no conditional skip. Fast canonical consumer tests mock the process
and use memfs. The opt-in native schema suite is separate from unit tests.

Schema baseline: publisher fifth-edition ECMA-376 Strict/Transitional WML and
their import closure, plus fifth-edition OPC content-types/relationships. All XSD
members, the separately pinned XML namespace schema and two original entrypoints
are SHA-256 checked. Publisher archives retain their existing research manifest
pins. No schema library or validator becomes a runtime dependency or shipped asset.
Validation uses stdin bytes, `--nonet` and an empty XML catalog environment; no
global catalog edits, implicit network resolution or product host authority.

The profile validates raw part grammar. It does not process MCE, validate every
package part/extension, enforce all cross-part references, evaluate fields, inspect
embedded binaries, verify signatures, calculate layout or repair documents.
Schema success is not visual correctness or whole-format/API conformance.

## Original acceptance

Ten native schema cases pass their declared checks: DOCX/DOTX creation with title,
styles, direct formatting and nested tables; preserving literal replacement;
unknown child, invalid numeric and boolean lexemes, malformed XML; schema-valid
missing hyperlink relationship; raw compatibility-extension rejection; and Strict
schema compilation classification. Seven fast mocked consumer cases cover exact
pins/version, absent prerequisites, closed paths, process failures and native
status classification. These original tests use no corpus downloads or assets.

Successful original outputs are independently reopened and checked for OPC/Word
references and untouched payloads. A missing hyperlink relationship passes XSD
grammar but fails both authoritative structural assertions and the product
semantic validator. No structural assertion was weakened. Native status 5 is
`schema-unavailable`, never document-valid. Timeouts and unexpected process exits
throw and fail qualification; native codes do not change the public CLI exit map.

## Classified discrepancies

| Finding                                                                                                            | Classification and retained requirement                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Raw WML import omits XML namespace schema location                                                                 | Setup closure issue; original entrypoint imports the independently pinned XML namespace XSD before WML; publisher XSD is unchanged                    |
| Strict WML defaults `beforeAutospacing`, `afterAutospacing`, `nlCheck` to `off`, which its ST_OnOff does not admit | Publisher schema inconsistency; compiler exit 5, Strict grammar remains unvalidated; do not rewrite defaults or claim Strict schema success           |
| OPC core-properties XSD imports remote Dublin Core schemas                                                         | Outside offline profile; attempted compilation failed missing imports; core properties are unvalidated by this schema gate                            |
| Raw `mc:Ignorable` and Word extension attributes/elements                                                          | Unsupported raw schema/MCE profile; retain source markup and classify baseline failures, without stripping or blanket repair                          |
| Initial unknown-child runs exceeded the 10-second native ceiling during host contention                            | Execution failure, not a pass; independently repeated rejection and final full schema run passed with the same ceiling and unchanged negative control |
| Applied style IDs without definitions                                                                              | Existing deliberate default/inheritance fallback, confirmed by original product regression; not a new defect or alias/API requirement                 |
| Publisher RELAX NG archives contain compact `.rnc`, not XML `.rng`                                                 | Not consumed by this xmllint profile; no converter, schema mutation or Strict success claimed                                                         |

The actual corpus diagnostic signatures are exclusively MCE `Ignorable`, Word
2010 `paraId`/`textId`/`docId`, Word 2012 `restartNumberingAfterBreak` and Word
2016 `durableId`. Every signature and occurrence count was compared before/after;
all are unchanged. This classification is based on exact namespaces and members,
not a rule that any validator rejection can be ignored.

## Disposable corpus edits

Both sources were hash-verified against the existing corpus manifest and edited
through the original shared utility engine with first body literal replacement,
explicit archive limits/signal and memfs publication. The replacement prepends
original `Verified ` wording to the selected literal. No copied text/assets enter
canonical tests or committed packages. Sources remain unchanged.

| Input                           | Parts | Edited bytes | Changed payloads         | Independent result                                                                                                                                |
| ------------------------------- | ----- | ------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gst-reforms-interim-appendixb` | 41    | 620472       | Only `word/document.xml` | CRC/membership/untouched payloads/OPC targets/owner IDs pass; three metadata parts validate; five WML parts retain baseline extension diagnostics |
| `hk-values-story-teacher`       | 17    | 209041       | Only `word/document.xml` | Same structural checks pass; same selected schema outcome; no new diagnostic                                                                      |

Input/output SHA-256 and exact selected part outcomes are in the JSON receipt.
The exploratory appendix-C edit refused the 512-MiB cumulative retained-byte
budget before publication; it is not a successful interoperability result or
reason to increase limits. No large-document support claim follows these inputs.

The existing small structural helper ceilings correctly exclude the larger corpus
profile. Disposable QA instead independently reads ZIP CRC/payloads and inert XML
relationship targets/owner IDs. Original unit helpers and required invariants stay
unchanged. No new product defect was found; the meaningful failure distinctions
are retained in small original consumer and schema regressions.

## Delivery boundary

Maintained package unit and lint/type checks, the dedicated schema gate, scoped
formatting and whitespace checks qualify this owned infrastructure change.
There is no visual CLI behavior change; screenshots/rendering are not claimed.
The exact JS/security mappings and historical API accounting are in the plan.
No model inventory disposition is promoted: inherited members, enums/aliases,
collections, helpers, APIs without reference tests and public underscore-prefixed
owners remain visible obligations. Later tasks remain pending. Delivery is a local
owned Conventional Commit on main only; no push or release.
