# Candidate replay adapter freeze

Own only this subtree and unique candidate-prefixed temporary scratch. Product, historical fixtures, and evidence remain read-only.

Candidate: `f8819e9d6b6d535b0626e0aa004bb10a7bc36785`. Reuse reviewed runner design at `7b983a73e9e484befe703246c1d170baf86c2a3f` with one build shared by BOTH unchanged cohorts. Fixed Git fixture bindings and SHA256s are in FREEZE.json. No assertions/inputs in either fixture are changed. Controls run separately for each cohort.

This adapter is frozen before this verifier's first candidate-source inspection, NOT before candidate commit. Candidate was committed 2026-08-27T10:52:09-05:00; original fixture at 10:53:31 and provisional at 10:58:10. Prior verifier's before-inspection claim must not be restated as precommit. Final acceptance requires classification, not a green denominator.

Run with a new unique path: `node tests/integration/shared-external-stdin-independent-20260827/candidate-review/run.mjs /tmp/shared-stdin-independent-candidate-<unique>`. Uses strict unhandled rejection children, 60-second exact child watchdogs, 180-second setup watchdogs, owned-child closure, full source/build/consumer inventory equality including new entries. Fixture expected failures, including original EOF dead-gate status 13, are retained, never waived as passes.

Author supplementary cases, if reproduced later, are distinct from independently frozen holdouts. No broader opaque-return retirement or post-disposal external-return barrier is asserted.
