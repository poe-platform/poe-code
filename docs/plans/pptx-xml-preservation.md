# PPTX bounded XML preservation

Own `packages/pptx/src/xml.ts`, `xml.test.ts`, the `invalid-xml` error code,
this plan and `docs/pptx/xml-case-map.json`. Preserve unrelated work, including
the modified pipeline plan. No safe-bash or root integration changes are needed.

Implement the xml-preservation task from the pipeline as an internal immutable
XML part codec. Use Saxes for admission and namespace resolution; retain original
source ranges rather than serializing a DOM. Merge namespace-qualified attributes
and singleton children recursively, with explicit schema sequence slots. Preserve
unknown content, lexical attributes, comments, PIs and whitespace. Reject ambiguous
singleton edits and malformed/out-of-order declared sequences. Namespace binding
edits are not exposed; newly authored names receive explicit local bindings.

Require byte/node/depth limits; prohibit DTDs and custom entity declarations or
references. XML predefined escapes and numeric character references remain legal.
Support UTF-8 and UTF-16 with BOM/byte order retained. Reparse bounded edited output
before returning it. This is synchronous bounded internal work, not a claim of
whole-operation scheduling, MCE interpretation or public owned model handles.

## TDD and validation procedure

1. Write original in-memory/memfs cases; demonstrate a failing package test run.
2. Implement admission, lexical retention and structured merge, and reduce any
   discovered defects into original regressions before fixes.
3. Run maintained pptx unit/lint and selected workspace build closure, plus scoped
   formatting and Git whitespace checks. No full pipeline execution.
4. For disposable QA, use only the first locally cached manifest document after
   verifying its SHA-256. Parse its XML members with explicit manifest ceilings;
   assert no-op bytes identical and exercise one isolated qualified attribute edit.
   Do not alter or ship fixture bytes. This is structural QA, not visual fidelity.
5. Stage only named owned files and commit on main; do not push or release.

## Accounting boundary

Consult both complete upstream inventories and existing case ledger. Preserve all
parameter identities and deferred BDD/model/API obligations in the supplement.
No original public API is hidden because its name begins with an underscore.
Internal XML nodes do not replace the J09 owner-validated public views. Shared
command grammar, SDK methods, selectors, schema/capabilities and CLI acceptance
remain pending their owning implementation tasks. No CLI is exposed by this task,
so no visual CLI behavior changes or screenshot claim is appropriate.

Historical audit statements that adaptation has not begun describe their earlier
research baseline. This receipt records only this implementation, not full parity.
All implementation/assets/assertions are original; existing standalone legal
notices remain untouched. No README edits or new reference assets.

## Verification receipt

- TDD: the initial maintained package run failed on the absent XML module. Later
  focused cases demonstrated failures for multiple-insertion ordering, cyclic
  authored edits, invalid Unicode replacement and singleton removal before fixes.
- Final maintained `npm run test:unit --workspace=pptx`: 327 passing tests in
  10 files, including 38 original XML cases; the XML file completed in 16 ms.
- `npm run lint --workspace=pptx`: ESLint plus production/test TypeScript passed.
- `npm run build:workspaces -- --workspace=pptx`: declared two-package closure
  rebuilt office-package and pptx successfully. No whole pipeline was executed.
- Disposable QA: the first manifest file matched SHA-256
  `885e923f148cdf4680372abe54496c824ab3a2a2d8a59fd9703d66e0aeb1164c`.
  All 35 XML/relationship streams passed byte-exact no-op checks and isolated
  qualified-attribute edits. Original inputs stayed byte-identical. No corpus
  mismatch or new corpus regression was found; no fixture was changed or shipped.
  This was structural QA, not application rendering or visual-fidelity evidence.
- The exact case supplement selects 72 unit identities: 14 adapted internal
  behaviors, 17 explicitly language-mapped internal behaviors, 22 partial
  foundations, 15 deferred OPC-writer workflows and four deferred typed schema
  validations. The complete ledger retains the other 2,628 unit cases and all
  973 BDD examples. Shared tests have explicit limited equivalence rationales;
  partial foundations and deferred cases are not counted as full adaptation.
- Forty-five inherited/direct public `element` members stay visible as deferred
  J09 owned-view obligations, including underscore-prefixed owners. No public
  API, CLI route, MCE semantics, schema validation or repeated-child mutation
  support is inferred from this internal singleton merge implementation.

XML admission counts element, text, CDATA, comment and PI nodes, with attributes
bounded by source bytes. Editing separately charges each visited merge, attribute,
sequence declaration and child request to the explicit node/work ceiling. New
subtrees use iterative traversal and the same depth ceiling; namespace declarations
are generated locally and never rewritten on existing elements. Existing source
ranges are copied exactly, including lexical no-op attributes and removed-child
tails. UTF-8 output length is checked before byte allocation. No ambient I/O or
network capability exists in the codec.

Only the five owned files named at the start belong to the atomic local commit.
Local commit delivery is reported separately; no push or release is authorized.
