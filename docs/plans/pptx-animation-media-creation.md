# Media timing creation assertion receipt

This atomic test improvement closes the three directly timing-related source
variants retained in the animation research ledger. It does not change media
implementation or claim a live media object model.

Original in-memory cases cover absent timing, one existing video, and an empty
timing root missing its child list. Assertions independently inspect exact timing
IDs, shape targets and indefinite start conditions. Existing video markup and an
opaque extension must survive byte-for-byte; input memfs bytes remain unchanged.
The third variant deliberately preserves unrelated content instead of replacing
the entire timeline. Source identities and this mapping remain in research only.

The focused three-case Vitest suite passes against the existing media behavior.
Initial fixture failures were corrected by retaining XML document ownership and
using an archive writer compatible with the independent ZIP inspector. No product
code was changed to accommodate the assertions. Final maintained package checks
are recorded with the animation editing QA receipt.

Owned file: `packages/pptx/src/animation-media-creation.test.ts`. No downloads,
host file tests, README changes, push or release.
