# Isolate the real Vitest fixture

The complete maintained unit route reproduces a failure when its temporary root
is inside the checkout. The integration fixture launches Vitest with its own
root and working directory, but without its own configuration. Vitest discovers
the repository's ancestor configuration and applies its unrelated include
patterns; the fixture's two cases are not discovered at all.

The original failure is retained in `/tmp/issue687-full-test-v2.log`. A two-case
local replay produces an empty JSON report, and the verbose replay in
`/tmp/issue687-vitest-child-verbose.log` prints the inherited repository patterns.
This is a fixture isolation defect, not evidence that ZIP or the runner's case
mapping is wrong.

Give the existing real-process integration fixture an explicit local Vitest
configuration. Preserve both original cases, the intentional failing assertion,
the expected per-case results and cleanup. Do not change product configuration
discovery or mock away the real runner. Verify the focused integration test and
then repeat the complete maintained unit route with isolated temporary storage.

The focused real-process integration test passes in
`/tmp/issue687-vitest-fixture-green-v1.log`. Repository lint, TypeScript and
workflow checks pass in `/tmp/issue687-lint-v5.log`. The complete unit-route
repeat has passed the shared Vitest stage and entered Safe Bash's maintained
workspace task; that is progress, not a claim that the entire route has finished.
