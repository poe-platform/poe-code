# Live slide part access

The inherited inventory obligation `pptx.slide.Slide.part` (declared on
`pptx.shared.PartElementProxy`) is implemented as the synchronous readonly
`Slide.part: PartView` property. Existing package and XML view behavior remains
bounded by the shared SDK contract; this is not a claim that all source part
methods are supported. No dedicated `Slide.part` case was found in the collected
slide test rows, so independent original coverage is required and provided.

`packages/pptx/src/slide-part-contract.test.ts` imports the public package exports
and proves stable owner identity, same package membership, live bytes after a
slide name edit, defensive byte copying, internal layout relationships, and
save/reopen. It checks the existing SDK-backed command route
`pptx xml get INPUT --scope slides --part /ppt/slides/slide1.xml --json` against the
same current bytes using only memfs and explicit read/publication capabilities.
The read-only route reports zero affected objects and does not publish.

The second case proves a manually detached slide rejects `.part` with
`PropertyAccessError` / `property-unavailable`, rather than silently returning
undefined. The getter validates the drawing owner before returning its package
view. Python reference ownership maps to an explicit live JS `PartView` (J01,
J02, J09); bytes are isolated `Uint8Array`, and no ambient path/network access is
introduced. Asynchronous factory/save boundaries remain unchanged.

Red evidence: both original tests failed before implementation (undefined part,
missing detached access exception). Green evidence: both pass after the getter.
Root recheck: both tests pass (1.35 seconds total), scoped ESLint passes,
and `tsc --noEmit -p packages/pptx/tsconfig.json` passes. The initial maintained
package unit/lint/build checks passed; combined final checks are recorded in
[the integration receipt](public-closure-verification.md).

Outstanding: presentation layouts/masters and synchronous `slides.add_slide`
remain absent; slide background/follow-master-background graph access remains
absent. Ordinary shape part ownership was also found absent and is a separate
follow-on obligation. The full public API denominator is unchanged.
