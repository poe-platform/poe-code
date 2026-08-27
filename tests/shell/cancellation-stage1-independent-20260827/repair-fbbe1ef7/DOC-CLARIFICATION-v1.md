# Additive fallback clarification — no source defect

Root explicitly accepts deterministic configured-order fallback ONLY when multiple
raw controls have already aborted before the link observes them. Past ordering is
unobservable to this helper; no historical order may be inferred. This is not a
change to observed first-delivery admission or ranked settlement.

The repair behavior matches that clarification in N4 for BOTH real host orders,
A-before-B and B-before-A, with configuration A then B. N3 separately witnesses
real B-before-A delivery AFTER observation and requires B for admission. Both
pass; this is not a fallback exemption for observed events.

## Documentation gap and exact proposed addition

At author repair freeze `01fbb3880bbe662adb2c7371e52ea3b47c0549f4`,
`tests/shell/cancellation-stage1-20260827/repair-v1/POLICY.md:14` defines actually
observed order but does not spell out pre-observation ambiguity. At author evidence
`339da95906bd88d42435970beadcb620b72a7afd`,
`tests/shell/cancellation-stage1-20260827/repair-v1/evidence-v1/RESULTS.md:16`
mentions configured order after an observed control but likewise does not state
the multiple-preaborted fallback explicitly.

Suggested prose for a NEW additive author clarification, not either frozen file:

> When multiple raw control signals are already aborted before link observation,
> their prior abort chronology is not observable. The helper deterministically
> selects the first aborted control in configured order as its initial delivery
> and control-admission fallback; this does not assert which signal historically
> aborted first. Once a control delivery has actually been observed, its original
> origin retains first-delivered control admission priority over later controls.
> Root-caller and invoke admission priority, captured-unrelated-rejection policy,
> ranked settlement, and immutable delivery remain unchanged.

Relevant candidate source: `src/shell/cancellation.ts:292` (observed admission),
`:311` and `:439` (initial preaborted selection). These are pinned candidate
locations, not claims about concurrent live source. No author policy/freeze,
source or original independent report was edited. This doc-only clarity gap does
not negate root's explicit accepted fallback or the bounded passing repair review.
