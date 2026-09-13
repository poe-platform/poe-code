# Shadow owner attribute reconciliation

The four scoped source rows test namespaced attributes on the shape/group
properties owner, not attributes on the effect-list child itself. Existing
`drawing-accounting.test.ts` checked effect-list presence but did not independently
assert owner attributes for these setter cases.

Completed QA procedure:

1. Read exact parameter bindings from the behavior ledger for the four rows.
2. Add original tiny XML tests through exported `Shape.shadow.inherit`, with
   independently specified expected expanded names, attributes, and child lists.
3. Test ordinary and group owners, inserting a missing effect list and removing
   an existing effect list. Repeat each with absent owner attribute and with an
   original namespaced owner attribute.
4. Run the new test and existing drawing accounting suite: 2 files / 99 tests
   passed; new four cases took 6 ms. Production behavior already satisfied the
   contract, so no production change or failing-test claim was made.
5. Coordinate maintained package checks and commit with the parent agent.

Owned changes: new regression file and matching research receipt only. No host
I/O, fixture download, renderer, README, adapter, pipeline, push, or release.

Coordinator validation: maintained pptx lint passed, selected pptx workspace build
passed, and the package unit run passed 6,678 tests. Final new/corrected test
checks passed 113 tests; built adapter selector/script checks passed 45 tests.
Terminal help/errors were visually inspected. Details and execution boundaries
are recorded in `pptx-text-drawing-reconciliation.md`. Local commit only.
