# Existing numbering model workflow

Task: `adapt-upstream-tables-bdd` only; later tasks remain pending. This bounded
repair adapts the exact `num-access-numbering-part` BDD observation with ten
concrete numbering definitions. Source inspection uses the pinned DOCX audit and
`src/docx/parts/numbering.py` / `src/docx/parts/document.py` from
https://github.com/python-openxml/python-docx at
`e45454602b53e8e572b179ccf1c91093ec9f4ed7`. Research attribution stays here and
in the standalone legal notice, outside product identifiers and tests.

Owned package code: `package-view.ts`, `package-view-batch-operations.ts` and new
`numbering-model-workflow.test.ts`; the coordinator owns barrel exports, document
part integration, handle subtype declarations, maintained checks and commits.
No README, Git, push or release operations are performed by this worker.

## Red, implementation and evidence

`numbering-model-evidence-20260915/red.log` records six original failures before
implementation. Admitted document parts now return DocumentPartView; an existing
single internal numbering relationship returns the same owned NumberingPart.
Public `_NumberingDefinitions` is retained and exposes its documented length
protocol as `.length`, counting only direct same-namespace concrete `num` nodes,
never abstract definitions. The retained collection stays live across bounded
XML additions/removals. XML/package ownership, content type, name, blob ownership,
part views and relationship behavior reuse the inherited implementations.

Typed load rejects a conflicting content type before admission; its independent
red is `typed-load-red.log`. Package batch actions expose the same inherited views,
numbering getters and collection length through declared typed operation IDs.
The coordinator exports new classes and adds subtype handle identities. Eight
original tests plus twelve maintained existing package-view tests pass in
`final-green.log`.

## Explicit language and security mapping

The pinned `NumberingPart.new()` raises NotImplementedError. JS preserves this
visible unsupported behavior with UnsupportedEditError; no public member is
hidden because its name begins with an underscore. The documented missing-part
getter calls that unimplemented factory in the source. This bounded existing-part
profile likewise rejects missing creation before mutation; it does not silently
return absence, create an orphan or claim complete numbering authoring parity.
Ambiguous existing internal relationships reject instead of selecting one target.
Collections are live model views, not copies of source-private proxy internals.
No native interpreter, document fixtures, filesystem or clock discovery is used.

## Internal image binding

The coordinator's separate picture metadata red identified an admitted image
resource missing the shared characterization cache. The same owned package file
adds internal `packageBindImage` with exact owner/content-type/byte checks. It is
not a barrel export or arbitrary batch callback. Existing package-owner checkpoints
already restore that cache during transaction rollback; picture workflow tests
and evidence remain coordinator-owned.

## QA status

Renderer QA is not required to establish a stored concrete-definition count and
was **not run** for this profile. Table renderer-only behavior remains in the
explicit table QA plan. This bounded evidence does not qualify numbering layout,
list counters, whole-public-API coverage or later tasks.
