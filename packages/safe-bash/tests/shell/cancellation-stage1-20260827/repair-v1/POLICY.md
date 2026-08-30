# Stage 1 cancellation helper repair-v1 freeze

This author-owned repair suite is limited to independent findings P1 and P2 in
`tests/shell/cancellation-stage1-independent-20260827/BUGS-v1.md`. It does not
edit, replay, or rescore Locke's independent cohort or the original 38-case
author freeze. The original 10/12 independent result remains historical.

R01 requires snapshotted synchronous fanout to skip a subscription made
inactive by another callback without truncating still-active subscribers. R02
preserves the distinct whole-boundary-close behavior: close stops later fanout,
callback failures remain exact and ordered, and finalization occurs after the
active notification unwinds.

R03 requires admission to use the control origin actually observed first, not
configured array priority, while skipping the options getter. R04 preserves the
separate ranking rules: delivery stays immutable, admission and settlement may
prefer original outer invoke and root-caller origins, and reports retain the
original signal/frame. R05 prevents the repair from adding truthiness,
wrapping, or unequal treatment for falsy/equal reasons.

The five case identities and assertions are frozen before the helper repair.
Corrections require a new version and rationale beside these files. This is a
private Stage 1 helper repair only: no Runtime, Shell, contract, type, timeout,
export, package, or configuration integration is authorized.
