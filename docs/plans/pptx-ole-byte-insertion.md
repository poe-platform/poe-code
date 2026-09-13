# Explicit OLE byte insertion

Owner: delegated OLE domain work; root owns exports, commands and final commits;
media model owner supplies live returned interfaces. Only the new insertion module,
its original tests and this plan/evidence pair are owned here.

## Scope and execution

- Read root instructions, format/shared contracts and pinned API/test inventories.
- Reproduce missing `addOleObject` with an original failing import/acceptance test.
- Implement inert payload and explicit icon insertion in the format package.
- Test XML relationships, byte ownership, program identity, icon geometry,
  deterministic allocation, package preservation and admission failures in memfs.
- Root integrates the operation with SDK-backed `objects add` and generated schemas.

Completed: domain implementation and 19 original tests. First run failed because
the operation did not exist. A subsequent explicit graphic-data URI assertion
caught and corrected a namespace-suffix error. Focused tests now pass. A second red/green cycle added all three registered
package enum relationships/content types/extensions and default geometry, with
identity-only enum admission and opaque string program semantics.

## Agent QA procedure

1. Run `npx vitest run packages/pptx/src/ole-insertion.test.ts`.
2. Run package maintained lint/type checks with the completed collaborators' work.
3. Inspect command help/schema and capture the CLI screenshot after root integration.
4. Confirm direct/model insertion share this operation, and inventory/extraction
   preserve payload bytes without object activation.
5. Stage only owned files plus the root-reviewed integration files. No push.

No publisher fixture or cloned binary is needed for this original small case set.
