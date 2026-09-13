# Shape adjustments and freeform members

Owner: freeform_adjustments delegated agent. Root owns exports, command schemas,
shared integration and final explicit-file commits. Connector/group delegate owns
shape collection insertion. No publication or push is authorized.

Completed TDD steps:

1. Read root AGENTS.md, shared CLI/SDK contracts, relevant format requirements,
   API audit/inventory and test audit/inventory.
2. Add original model tests; observe missing module failures before implementation.
3. Implement adjustment normalized values, literal guides, every registered preset
   default, numeric assignment, ordered iteration and typed operation updates.
4. Implement freeform finite local coordinates, scaled placement, reusable
   conversion, returned operation members and collection protocols.
5. Reproduce and fix truncation of untouched integer adjustment guides; reproduce
   and fix operation application failing to account for live builder bounds.
6. Run narrow original tests, format owned new files, then maintained package
   lint/unit checks with the root's integrated work before committing.

Agent QA procedure:

- Run `npm run test --workspace=pptx` and `npm run lint --workspace=pptx` once all
  delegated modules are integrated.
- Inspect typed `shapes set` adjustment schema and failure before publication.
- Exercise `build_freeform` through the live owning shape collection; save/reopen
  an original in-memory presentation and verify IDs and exact geometry.
- Verify exports through the package's public entry point.
- No downloaded decks or native rendering are required for this model scope.
  CLI visual changes are the command owner's screenshot responsibility.

Research inputs are disposable text files under `/tmp`; extracted default facts
have provenance in docs/pptx and the package's existing standalone MIT notice.
No source runtime, templates, tests or binary assets enter canonical tests.
