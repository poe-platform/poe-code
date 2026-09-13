# PPTX comparison limit contract

Scope: align comparison limit admission with ordinary commands under
`docs/specs/office-cli.md`, retaining the format-domain engine and explicit I/O.
Ownership: `packages/pptx/src/command-diff.ts`, its existing test file, this plan
and `docs/pptx/common-contract-review-20260913.md`. Preserve all unrelated edits.

## Implementation and original tests

- Reproduce trusted XML/validation limit overrides with original memfs decks.
- Reject overrides above the same trusted ceilings as ordinary commands.
- Reproduce a compressed original deck whose expanded XML exceeds an explicit
  byte limit; apply the lowered limit to XML parsing.
- Retain comparison equality/difference as successful data and trouble/cancel
  exit semantics. Run focused comparison tests and maintained package lint.

## Agent QA procedure

Use the built public command engine and safe-bash PPTX adapter with identical
original in-memory decks. Exercise common paths, plural resources, rejected old
aliases, inapplicable flags, JSON envelopes, ordinary statuses and comparison
statuses. Check limit rejection before input reads and the compressed XML case.
Inspect public help/error screenshots without introducing screenshot unit tests.
Keep adapter QA ownership with the assigned integration worker.

Compare DOCX declarations to the shared contract; the DOCX executable schema and
runtime adapter are absent, so leave those paired halves pending. Do not fetch
documents, run a native office runtime, edit README files or perform a push.

## Outcome

Five original regression cases established the issue; the comparison correction
is complete. See the evidence receipt for observed results and remaining limits.
