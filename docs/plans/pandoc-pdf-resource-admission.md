# PDF resource profile admission

Enforce engine-owned resource semantics rather than trusting library acceptance:

- Restrict supplied fonts to sfnt TrueType/OpenType signatures. A valid WOFF generated in memory from the licensed packaged TTF was accepted before the fix; public API now rejects it before parsing/decompression.
- Add decodedImageBytes (default 32,000,000), reserving eight bytes per declared PNG pixel cumulatively before decode. A one-pixel original PNG ignored a ceiling of one before the fix. Pandoc charges this reserve to shared retainedBytes.
- Admit measurement layoutWork before building paragraph/cell line arrays, including empty cells. An empty two-cell table ignored a layoutWork ceiling of one before the fix.

Verification: original failing public tests first, then implementation; eight PDF and 893 Pandoc tests, both package lint/typecheck routes, and the maintained Pandoc build closure pass. Root normal build passed before the final empty-cell charge; scope rebuilt after it. These allowances count logical resources, not a proof of heap isolation or synchronous library preemption.

QA: existing representative PDF screenshot remains applicable because resource admission does not change default drawing geometry. Read it under docs/pandoc; independently inspect font embedding/page geometry/annotations through public tests. Full repository unit completion is not claimed: retry stopped after unrelated missing docs/plans/archive/cli-aliasing.md fixture.
