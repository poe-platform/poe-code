# Temporary Safe JS snapshot mutation quarantine

The user authorized temporarily disabling tests to unblock the release.

Release run `34931319430`, commit `55c7d8b1186be5e272595dc6499ec349fa86d833`, failed only the Safe JS snapshot mutation corpus test after 30,295 Safe JS tests passed. Its internal case time cap failed with `1255.3ms > 750ms` on the Ubuntu runner. The same test passed in the complete local unit run.

Temporarily skip the single test in `packages/safe-js/test/adversarial/snapshot-mutation.test.ts`. Preserve its corpus and assertions; all other Safe JS tests remain enabled. This does not repair the timing failure.

To restore:

1. Investigate the corpus case timing on the GitHub runner and remove machine-speed sensitivity without weakening mutation assertions.
2. Remove `it.skip` and its quarantine comment.
3. Run `npm run test:adversarial --workspace=@poe-code/safe-js` and verify the complete fresh GitHub unit gate.
