# Preserving XML child permutations

Scope: add an owned direct-child permutation primitive in `packages/pptx/src/xml.ts`
for slide-list movement. Root owns this primitive and `xml.test.ts`; no shared codec
or root API change is needed. The later slide-order operation uses this primitive.

The initial two tests failed because `reorderChildren` did not exist. Implementation
replaces each child span with another original child span under the same parent.
All direct children must occur exactly once. Missing, duplicate, foreign, nested
and foreign-parent handles fail. Original namespace bindings, raw attributes,
interstitial comments/whitespace and unrelated markup remain intact. Independent
literal expected XML checks the permutation, and identity order retains exact XML.

Validation: `npm test --workspace=pptx` passed 739 tests, including 64 XML tests;
`npm run lint --workspace=pptx` passed ESLint and both TypeScript checks. The selected
maintained pptx build closure passed. This internal primitive has no standalone CLI
visual change; the consuming operation's screenshots and QA are recorded in
`docs/plans/pptx-slide-order-visibility.md`. No README edit, push or release.
