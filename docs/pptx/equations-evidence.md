# Equation evidence and language mappings

F41 is an additive format obligation. The pinned reference test inventory has
2700 unit variants and 973 expanded BDD examples; the reconciled public API
inventory has 2407 records, including inherited/underscore-prefixed members.
None of those records names OMML or equations. This absence does not remove the
format requirement or establish whole-public-API coverage. The focused
preservation ledger records the general text/slide behaviors relevant here.

Implementation and tests are original TypeScript with original XML and text;
no copied implementation, source fixtures or translated source-test wording.
Existing standalone legal notices remain applicable to their respective material.
No new substantial derived material was incorporated in this change.

## Exact mappings

- Equation input is explicit `BinaryInput`; reads and mutation are always async.
  XML input has explicit byte/node/depth limits and no host file lookup.
- OMML is XML data, never an expression to evaluate or typeset. DTD/entity
  declarations and malformed XML are rejected by bounded parsing. Existing
  unsupported math remains preservation data, not permission to author it.
- Equation records are detached readonly inventory values, not a purported
  reference-project live equation class. Text is an ordered literal token
  concatenation, not a formula rendering or semantic interpretation.
- Namespace URI identity governs admission; prefix spelling is immaterial.
  Extracted markup carries namespace bindings needed for standalone parsing.
- CLI positions are one-based; inventory paragraph/equation indexes explicitly
  identify their zero-based coordinate system. Locations retain package
  fingerprints. Missing/ambiguous/stale selection follows common typed errors.
- Existing whole-object text setters retain the shared SDK's documented
  destructive scope for ordinary text. Replacement that would delete equations
  or their fallbacks is rejected as an unsupported edit. Preserving `text replace`
  must not bridge or edit opaque equation branches. No inherited API or underscore-prefixed type is removed
  from the public inventory to claim coverage.

## Standards/documentation reconciliation

[MS-ODRAWXML 2.2.5](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/853b19c7-68a9-4f9a-a2ae-5e6cb0d02e62)
describes the DrawingML math extension and its compatibility integration.
Its run-text cross-reference points to DrawingML text, while the actual admitted
corpus uses `m:t` with optional DrawingML run properties. The official
[Math.Run](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.math.run?view=openxml-3.0.1)
and [Math.Text](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.math.text?view=openxml-3.0.1)
  API documentation also identifies mathematical text. The bounded validator must
admit original `m:t` cases; formatted corpus equations need not be writable to be
inventoried and preserved. No full schema-validation or universal Office rendering
claim follows from this bounded subset.

Authored mathematical and drawing-text namespaces must match each other and the
selected presentation's Strict/Transitional dialect. Insertion does not silently
convert either dialect. Both matching directions and both mismatch directions
have independent original serialized-XML assertions.

QA procedures and current execution receipts belong in
[the equation plan](../plans/pptx-equations.md).
