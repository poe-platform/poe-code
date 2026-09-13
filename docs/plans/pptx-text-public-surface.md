# Live text object surface

Scope: extend existing TextFrame, Paragraph and Shape types on main. Preserve
unrelated work and dirty exports. No README changes, network, runtime tools,
publisher fixtures, push or release. Evidence lives in docs/pptx.

## Ownership and implementation

- Root owns TextFrame, shared invalid-handle error and bounded XML subtree support.
- Paragraph delegate owns Paragraph/Run/Font implementation and original tests.
- Shape delegate owns Shape text properties and frame ownership tests.
- Table delegate owns existing table surface; coordinates FillFormat changes with
  the shape owner. No independently implemented competing editor.

## Agent QA procedure

1. Read root instructions, shared Office SDK/CLI contracts, PPTX specification,
   API and test audit/inventory, language mappings and existing live types.
2. Reproduce absent public members using original small in-memory tests. Use memfs
   for fixture I/O; no disk fixtures or imported publisher/source test content.
3. Implement bounded child views retaining owner identity and resource limits.
   Separately exercise text assignment, clear, and preserving text replacement.
4. Verify read-only queries do not create missing text frames. Check live child
   edits, immutable membership snapshots, invalidated handles, returned types,
   and failed edits leaving existing handles valid.
5. Run maintained PPTX test and lint routes, plus focused XML tests. CLI display
   changes require screenshots; model-only changes do not alter CLI presentation.
6. Stage only owned files and this plan, commit atomic improvements with
   Conventional Commits, and report local hashes. Never push or release.

## Progress

- Confirmed missing TextFrame paragraph membership, append and clear with three
  failing original memfs tests.
- Added bounded XML subtree extraction with red/green original tests, preserving
  source limits rather than manufacturing larger child edit limits.
- Public graph coverage remains partial; this plan does not claim all inventory
  rows or shared command schemas are implemented.

Final review additionally found table child XML views manufactured larger limits.
An original regression failed on the exposed child view; using admitted subtree
limits made it pass. The same test retains the shared outer publication guards.
The returned Run, Font and InvalidHandleError are exported from the package root;
only those owned export hunks are staged from the already modified index file.

## Verification results

- Maintained `npm run test:unit --workspace=pptx`: 194 files, 4,499 tests passed.
- Subsequent public bounded-XML export regression: three tests passed after its
  failing baseline; no model implementation changed after the full unit run.
- Maintained `npm run lint --workspace=pptx` passed after the final exports.
- Selected build closure `npm run build:workspaces -- --workspace=pptx` passed.
- Executed the compiled package root exports with an original bounded XML frame:
  typed paragraph/run/font edits and destructive invalidation passed. This checks
  built exports, not a packed external consumer or root Presentation factory.
- No CLI display layout changed, so no screenshot was needed. No README, publisher
  artifacts, native renderer, reference runtime, implicit network, push or release.
- Separate local commits record XML subtree limits, ZIP assertion compatibility,
  and the metadata mutation count schema correction. The live model integration
  is one related improvement because Font/cell FillFormat and owner-bound text
  share the same extended primitives.
