# PPTX handout inventory domain implementation

Scope: bounded F49 inspection of presentation-listed handout masters, stored print
properties and view properties; retain existing notes size and explicit master
text operations. No renderer, pagination calculation, network, host file access,
README edits or reference assets are added.

## Ownership

Domain-owned files are `packages/pptx/src/inventory.ts`,
`packages/pptx/src/presentation-settings.ts`,
`packages/pptx/src/presentation-settings.test.ts`,
`packages/pptx/src/handouts.test.ts` and this plan. CLI adapter tests and research
accounting are independently owned by their delegated agents. Existing unrelated
changes in public index and command infrastructure are preserved.

## Contract

- `readSelectionIndex(input, context).inventory.handoutMasters` lists canonical
  part URIs selected by the main presentation's `handoutMasterIdLst` entries in
  stored order. Merely attached or detached handout resources remain visible in
  generic parts/relationships and are not promoted into this list.
- `readPresentationSettings(input, context)` adds `printProperties` and
  `viewProperties`, each either null or `{part, xml}`. Print inventory extracts
  only `prnPr`; view inventory extracts the full `viewPr` root. XML is bounded,
  namespace-complete standalone markup, not a claim of identical lexical
  encoding to the original bytes. Stored attributes and unsupported subtrees
  remain visible without synthesizing layout defaults.
- Existing `notesWidth`, `notesHeight` and `notesOrientation` retain numeric EMU,
  null/absent and square-orientation behavior. Reads never author a notes size.
- View targets must be unique internal relationships with matching content type
  and dialect root. Print relationships retain their existing equivalent checks.
- Namespaces govern identity: ignorable foreign elements/attributes with matching
  local names do not override handout list entries or relationship identities.
- No new text mutation API is necessary: existing literal text replacement has
  explicit `handout-master` scope. Independent CLI tests cover its isolation and
  retention boundaries. No handout pagination or slide-thumbnail regeneration is
  inferred from print values, notes dimensions, or slide operations.

## TDD evidence

An original stored ZIP generated into memfs initially produced five failing cases:
missing handout inventory, missing print/view inventory, and three malformed view
inputs accepted as valid reads. After implementation all passed. The expanded
nine-case domain suite covers both Strict and Transitional XML, detached resources,
foreign namespace lookalikes, missing relationship identity, external view targets,
wrong view root/content type and ambiguous view relations. Independent expected
XML literals assert the print/view results; tests do not read downloads.

Focused combined run: 48 tests passed across handouts, presentation settings and
inventory before the additional four variant/security cases. Final handouts run:
9/9 passed. `npm run lint --workspace=pptx` passed. Root coordinates final maintained
workspace tests/build to avoid competing writes to generated package outputs.

## QA procedure and remaining boundaries

Use only disposable files named in `docs/pptx/corpus-manifest.json` for any real
presentation inspection. Inspect before and after through SDK and CLI, compare
unmodified handout, print/view and notes resources byte-for-byte, and reduce any
finding to a small original memfs regression. Never commit corpus files or derive
rendered pagination claims. This domain task did not download or render fixtures.

Slide split creates new presentations; its current seed omits source handout and
print/view resources. That distinct operation is not certified as preserving these
resources by this change. General add/duplicate/reorder/remove/visibility and
explicit shared text operations are delegated for independent preservation tests.
