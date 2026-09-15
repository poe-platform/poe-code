# Typed document properties

Ordered task66's bounded typed property utility is locally verified. The sole
format contract is docs/specs/docx.md; ownership, original red/green evidence and
QA procedure belong in docs/plans/docx-typed-properties.md. The separate live
model API and corpus campaign remain unverified.

The utility wires global properties list/get and typed set/remove, qualified by
original TypeScript, public browser closure and actual explicit-plugin Shell tests.
Earlier value normalization alone was not document-property implementation.
Inspection requires exact package metadata role admission and opaque retention.
The intended utility snapshots use UTC strings, distinct from planned owner-bound
Date/CoreProperties live APIs. The retained reference census includes 36 collected
core-property cases; it is preparation and does not close product behavior.

Verified command examples:

```sh
docx properties list input.docx
docx properties get input.docx --name core:title --json
docx properties set input.docx --name custom:Approved --type boolean --value false --output result.docx
docx properties remove result.docx --name custom:Approved --output cleaned.docx
```

Names are case-sensitive. Unqualified stored-name collisions refuse selection;
explicit qualifiers distinguish groups. Missing custom creation requires type.
Supported existing custom variants retain their type/range and safe IDs; opaque
or unsafe metadata remains preserved. Removal retains the empty metadata part
and its relationship. Dates use explicit UTC utility strings at whole seconds.
No cached count, created/modified timestamp or unknown subtree is updated as a
side effect. The public utilities are inspectDocumentProperties and
editDocumentProperties; their bounded bytes/capability interfaces do not implement
the separate live document/CoreProperties model.

Maintained uncached DOCX tests pass 97 files/2,197 cases; workspace lint and the
selected five-stage portable build pass. Public/engine checks pass 11 cases.
Independent current DOCX Shell tests pass all 12 files/94 cases with zero skips;
literal registration passes 108 cases. Guarded source/test/26-consumer-group
typechecking passes, separately from runtime qualification. The independent
19-call original memfs campaign verifies typed values, named files, in-place
edits, VFS scripts, redirects, binary pipes and exact refusal effects; inspected
screenshots use faithful 100-cell hard wrapping. Root help is long and JSON is
verbose. These checks establish bounded utility behavior, not full conformance,
live model parity, rendered-document fidelity or downloaded-corpus outcomes.

No README edits, downloaded fixtures, implicit network, native product/build
fallback, push or release. Task65's portable selected dependency build remains
verified independently from default full-workspace/native build behavior.
