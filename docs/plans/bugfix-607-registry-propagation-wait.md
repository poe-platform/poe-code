# Issue #607: allow bounded npm publication processing

## Validated failure

Toolcraft release run 33892240751 passed the Node 18.18, 20, 22 and 24
standalone checks. Its first publication attempt accepted schema version 0.0.198
but failed the following 12-attempt, five-second registry wait. The schema
became visible afterwards.

The retry accepted toolcraft@0.0.198 at 16:09:02 UTC on September 4, 2026.
npm explicitly reported that processing could take a few minutes. The next
registry wait failed at 16:10:13, and a read-only lookup still returned E404 at
16:13:06. The exact version became visible on a later lookup. This validates
insufficient propagation allowance independently of the repaired Node issue #606.

## Change

Give both registry-availability steps 120 attempts spaced five seconds apart.
Keep an eleven-minute GitHub step timeout so slow registry calls cannot turn
the nominal ten-minute polling window into an unbounded wait. Preserve the final
unsuppressed npm lookup, publication guards, provenance and both signature audits.
This does not guarantee registry availability or mark pending uploads successful.

## Validation and delivery

Run the maintained `npm run lint:workflows` and `git diff --check`; do not add
workflow unit tests. Commit separately from product issue #582. Verify remote
main delivery and the actual publication workflow independently. Close after
verified delivery, while continuing to monitor publication and signature checks.
