# Preserve opaque XML payloads during interpretation

Scope: a narrow prerequisite discovered while implementing PPTX selectors. The
compatibility interpreter previously traversed application-defined extension
payloads even when the caller only needed their surrounding drawing identities.

## Evidence and original regression

The manifest-listed cached presentation template, verified with SHA-256
`885e923f148cdf4680372abe54496c824ab3a2a2d8a59fd9703d66e0aeb1164c`, failed selector
admission with `unsupported-profile` inside an extension payload. The finding was
reduced to authored in-memory XML with an original namespace. No downloaded bytes
or reference implementation code entered the tests.

The original regression first failed, then passed with an explicit optional list
of opaque element names. Callers can skip semantic traversal of those payloads
without claiming their namespaces are understood. Container attributes and
`MustUnderstand` still undergo the existing checks. Original bytes remain in the
preservation tree, including after an unrelated merge; the option list is copied
and preserved by subsequent merges. Unknown required content outside an admitted
opaque container continues to fail.

## Verification

- `npm run test:unit --workspace=pptx`: 447 tests passed across 14 files, including
  40 compatibility tests and the independently authored selector regressions.
- `npm run lint --workspace=pptx`: passed.
- Corpus retry matched independently extracted slide IDs and object IDs after
  selector callers explicitly opted in their extension/payload containers.

This change adds the interpreter capability only. Selector opt-ins, CLI wiring and
their usage documentation belong to the subsequent selector feature commit.
No README, corpus, push, release or whole-pipeline change.
