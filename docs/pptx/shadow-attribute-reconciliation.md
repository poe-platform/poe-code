# Shadow inheritance owner attributes

The original regression file `shadow-attribute-preservation.test.ts` supplements
`drawing-accounting.test.ts` with independent structural assertions for four
source setter cases. Each target case executes twice: with no owner attribute,
and with `{http://schemas.openxmlformats.org/drawingml/2006/main}retained` set to
`kept-value`. The latter replaces the source fixture's arbitrary local attribute
name `b` and value `c` while retaining its exact namespace and preservation
semantics. Names/values are opaque to the inheritance operation, so this rename
is behaviorally equivalent; tests compare the complete attribute list instead
of deriving expected values from the mutated model.

| Source ledger row | Target parameter case | Exact behavior equivalence |
| --- | --- | --- |
| presentation-unit-35561e57cd85 | spPr, inherit false | Missing effect list becomes exactly one empty DrawingML effectLst; ordinary owner namespaced attribute survives. |
| presentation-unit-6de6665a8289 | grpSpPr, inherit false | Missing effect list becomes exactly one empty DrawingML effectLst; group owner namespaced attribute survives. |
| presentation-unit-8f8761147cb8 | spPr, inherit true | Existing empty effect list is removed; ordinary owner namespaced attribute survives. |
| presentation-unit-98f1103aac69 | grpSpPr, inherit true | Existing empty effect list is removed; group owner namespaced attribute survives. |

Each case independently asserts the owner expanded name, complete attribute list,
complete child expanded names/attributes/children, unchanged sole owner count,
and public inheritance value before/after. Absence branches ensure mutation does
not invent attributes. Public XML views replace source XML-string equality;
namespace prefixes and serialization whitespace are not API promises.

These four rows do not concern retaining attributes *on* effectLst. Setting
inheritance true deliberately removes that definition, and no child-attribute
preservation claim is inferred. No layout/rendering semantics are involved.
The tests use original in-memory XML only; there is no copied source code or
fixture asset and no additional derived-material notice is required.

Focused execution: 2 files / 99 tests passed including the four new cases.
Production already passed; this is additional conformance evidence, not a
production bug fix. No broader inventory completion claim is made.
