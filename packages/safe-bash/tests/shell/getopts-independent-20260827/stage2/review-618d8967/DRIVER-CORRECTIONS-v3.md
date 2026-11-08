# Public expectation correction v3, after the initial execution

Initial public controls are **25/26**, retained in .work/logs/independent-public
and PUBLIC-OBSERVATIONS. The failed D03 assertion expected `b:2` but obtained
`?:2`. No source bug is established by this failure.

The input first scans a from -ab, leaving visible OPTIND=1 with hidden b pending.
The second dispatch promotes the same value1 through middleware. Approved D03
explicitly says same-value promotion/forwarding does not reset: it scans b,
publishes2, and therefore does not meet the conditional restore predicate
`state.variables[key] === saved.overlay` (2 != 1). The third scan correctly sees
EOF and publishes `?:2`. The expectation, not the implementation, contradicted
the already-approved mapping. See committed candidate runtime.ts:925-935,990-994.

The original executed driver and captures remain unchanged. A separate v3
single-test supplement checks the corrected exact script plus a different-value
overlay0 nonrestore and the existing author's changed-value restoration example.
These three bounded observations address the already-frozen two D03 branches;
they are not a new matrix or a retrospective 26/26 rescore.
