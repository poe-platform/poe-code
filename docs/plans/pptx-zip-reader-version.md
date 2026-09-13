# PPTX original ZIP assertion reader

Own `packages/pptx/tests/zip-reader.ts`, the original
`packages/pptx/src/zip-reader.test.ts`, and this plan/evidence receipt.

Observed failure: retained original stored archives declare extraction version 20
but the independent assertion reader demanded exactly 10. The existing original
`storedArchive` fixture writer explicitly writes 20 to both headers. A no-op
sanitization correctly retained those bytes and exposed the reader assumption.

TDD: new parameterized in-memory tests accepted stored version 10, failed on 20,
and rejected disagreeing local/central versions. Permit 10 or 20 for stored entries
while preserving deflate version 20 and header agreement checks. No product change.

QA: run focused ZIP reader and sanitization tests, then the maintained package unit
route. Do not create fixtures on disk or use downloaded archives. The focused
four-file run passed 22 tests, including three original ZIP reader assertions.

Separate preexisting metadata tests revealed canonical URI/category expectations
and inherited `affected: const 0` mutation schema drift. Their local corrections
and the original `metadata-result-schema.test.ts` remain outside this commit.
