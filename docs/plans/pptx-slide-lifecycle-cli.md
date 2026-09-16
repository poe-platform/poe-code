# PPTX slide lifecycle CLI invariants

## Scope and ownership

Assigned worker owns only this plan and
`packages/safe-bash/tests/commands/pptx/slide-lifecycle-invariants.test.ts`.
Domain implementation and commit ownership remain with the coordinator and domain
worker. No product source, README, downloaded fixture, or unrelated work changed.

## Original cases and independent assertions

Five node:test cases exercise public SDK exports and actual virtual-shell `pptx`
commands. Fixtures are handwritten bounded OPC graphs in memfs: two slides with
nonsequential IDs 401/709, one shared image, one layout/master cycle, and optional
opaque XML extension. Images are a one-pixel GIF or inert empty SVG with metadata;
neither fixture contains supplied or reference-project artwork.

- Same-name and same-position updates preserve exact archive bytes, including
  opaque extensions, through SDK and binary CLI stdout.
- Renaming changes only the selected slide payload; moving changes only the
  presentation list. SHA-256 checks cover every other original part. Independent
  Saxes parsing verifies literal expected labels and stable slide IDs/order.
- Default shared-media duplication allocates slide ID 710 and retains one image.
  Deleting that duplicate restores the original slide/relationship graph and
  original part inventory. Duplicate and move serialization are deterministic.
- Opaque extension duplication fails with `unsupported-edit` through SDK and
  exit status 1 with no binary publication through CLI. Source bytes remain exact.
- Isolated-instance SVG duplication retains both original and copied image bytes.
  Deleting the copied slide restores original slide IDs but deliberately retains
  the now-unreferenced copied image, with exactly the same bytes. This is the
  documented conservative removal policy in [slide removal](pptx-slide-removal.md),
  not general garbage collection.

SDK/CLI equality supplements independent graph, hash, and explicit byte checks;
it is not used as the sole behavior oracle. Every shell is disposed. Zero-delay
cooperative scheduling is replaced with setImmediate only inside these tests.
No unit operation opens host files, downloads documents, or invokes native tools.

## Findings and TDD evidence

The first four lifecycle cases passed against existing behavior. The domain
worker separately captured the failing SVG copy regression before its source fix;
the adapter test confirms that fix through the public engine injection boundary.
An initial deletion assertion incorrectly expected media garbage collection and
failed because `shared-copy1.svg` remained. Review of the existing removal policy
corrected the test oracle; no product fix was requested for that behavior.

## Accounting boundaries

Consulted [test audit](../pptx/upstream-test-audit.md),
[expanded test inventory](../pptx/upstream-test-inventory.json),
[public API audit](../pptx/upstream-api-audit.md), and
[public API inventory](../pptx/upstream-api-inventory.json). These are supplemental
F07 metamorphic/graph cases, not an assertion of whole upstream variant coverage
or full live object-model implementation. Exact upstream-row accounting belongs
to the coordinator's bounded lifecycle research receipt. Neutral operational SDK
methods use explicit async byte input/context and one-based typed selection;
CLI uses plural `slides`, `set`, `move`, `duplicate`, `remove` and binary output.
No source identities, names, copied assets, or attribution are in the tests.

Consulted [corpus manifest](../pptx/corpus-manifest.json). No corpus acquisition,
external application rendering or visual CLI changes occur in this test-only
slice. Disposable QA, if performed by another owner, must retain separate evidence.

## Verification

`node --import tsx --test packages/safe-bash/tests/commands/pptx/slide-lifecycle-invariants.test.ts`
passes all five original cases. This is a narrow node:test invocation using the
maintained tsx runner, not a whole package or pipeline completion claim. Root
coordinates integration-input registration and maintained package checks.
