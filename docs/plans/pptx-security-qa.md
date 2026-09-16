# PPTX security admission QA

## Procedure

1. Read the corpus manifest and verify the first available cached presentation's
   byte count and SHA-256 before admission. Do not download missing fixtures.
2. Load those admitted bytes with explicit QA limits. Add an original orphan
   `vbaProject.bin` part in memory with an ordinary binary content type. Preserve
   the cached input and every original package part.
3. Assert that SDK metadata reads still work and metadata mutation rejects with
   `unsupported-edit`. Send the same bytes through an injected memory filesystem
   to the actual Shell `pptx properties set` route; require status 1, no binary
   output and unchanged input.
4. Capture the actual shell diagnostic with the maintained generic terminal
   screenshot utility and inspect the PNG. No root executable change or
   presentation rendering is implied.
5. Run the maintained pptx workspace unit/lint checks and focused shell metadata
   tests. Record findings; retain only original in-memory unit regressions.

No corpus or screenshot bytes are staged. No native Office runtime, network,
implicit product host I/O, whole pipeline, push or release is part of this QA.

## Results

The manifest's first cached deck passed its 1,202,514-byte and SHA-256 check:
`885e923f148cdf4680372abe54496c824ab3a2a2d8a59fd9703d66e0aeb1164c`.
An original three-byte orphan `/ppt/vbaProject.bin` with ordinary binary content
type was added only in memory. SDK metadata reads succeeded; mutation rejected
with `unsupported-edit`. Actual Shell mutation with `--output - --force` returned
status 1 and zero binary output. Its memory input and cached input were unchanged.

The maintained `npm run screenshot` utility captured
`/tmp/pptx-security-admission.png`. Visual inspection confirmed that the actual
command, diagnostic, status and input-integrity receipt were legible and unclipped.
The virtual command is exercised through an injected Shell; the root poe-code
screenshot wrapper is inapplicable. This is terminal QA, not slide rendering.

The corpus experiment confirmed the small original unit regressions; it revealed
no additional issue requiring a downloaded unit fixture. Final maintained check
results are in the linked domain and CLI plans. Maintained
`npm run typecheck --workspace=virtual-bash` passed source/tests and all 26
consumer groups after the independently committed fixture byte-map correction.
Expected negative compile cases retained their failure statuses; this is compile
evidence, not additional consumer runtime qualification.
