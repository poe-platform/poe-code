# Public PPTX unit and color helpers

## Scope and ownership

Extend existing `Length`, `RGBColor`, `ColorFormat` and `ShapeColorFormat` types.
Do not create another document editor. This task owns color-helper source,
original helper tests, color expectation adjustments and this evidence pair;
shared errors and enum definitions belong to the coordinator and enum worker.
The shape source is shared only by separately owned method sections.

## Procedure

1. Read root instructions, shared SDK/CLI contracts, format contract and pinned
   API/test inventories and language mappings.
2. Add original no-I/O numeric/protocol cases, run them before implementation,
   and preserve the failure categories in evidence.
3. Implement checked RGB lookup and exact error categories; integrate documented
   color enum values into the existing model while preserving operation XML tokens.
4. Validate model color assignments, live ownership and rejection without mutation.
5. Run focused tests and package-maintained lint/test checks via the coordinator.
6. Stage only owned files and plan/evidence in the coordinator's atomic commits.
   No push, release, README edits or downloaded fixtures.

## Agent QA

Inspect small original XML in memory through the supplied bounded parser. Confirm
zero RGB channels, absent color, return-only theme sentinel, and invalid input
remain distinct. Compare reopened properties with emitted XML token values.
No native rendering or filesystem fixtures are necessary for these value changes.
The CLI operation representation remains unchanged, so no visual CLI change is
introduced by this work.
