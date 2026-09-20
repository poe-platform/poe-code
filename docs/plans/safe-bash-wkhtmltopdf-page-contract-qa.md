# wkhtmltopdf pure page contract QA

This plan covers the pure final-layout page accounting API only. It does not
qualify HTML/CSS rendering, native compatibility or the public safe-bash export.

1. Run the command workspace unit task. Verify the explicit count examples and
   exhaustive small-count controls preserve physical multiplicity, copy identity,
   logical totals and outline totals independently.
2. Run command workspace lint, including source and test typechecking.
3. Build the selected workspace with the maintained build closure route.
4. Import the built workspace API directly. Parse an invocation with a cover,
   then supply independently chosen layout page counts. Confirm cover retains
   `pagesCount`, clears furniture and outline inclusion, and copies repeat the
   output without multiplying logical or outline totals.
5. Attempt an absent grid capability and an output limit overflow. Confirm
   structured rejection rather than fallback or partial records.

No CLI command or visible CLI output changes in this milestone, so screenshots
do not apply. No resources are acquired by these synchronous pure APIs; VFS
output cleanup, byte streams, deadlines, checkpoint/replay and realm consumers
remain dependent integration gates. The command workspace remains private.

Execution, 2026-09-18: workspace unit task passed all 32 tests (no skips), workspace
lint and source/test typechecking passed, the selected maintained workspace build
passed, and built-API manual steps 4–5
passed. The original engine tests failed before implementation; independent
empty-object work and unknown-feature negative controls also failed before
their fixes. No native execution, renderer acceptance, packed-consumer checks,
root-wide gates, commits, remote delivery or release was performed.
