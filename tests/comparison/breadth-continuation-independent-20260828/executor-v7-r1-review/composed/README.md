# Independent composed review — preexecution design

DATA / SYNTHETIC / STUB ONLY. This directory is not an admission grant.
The implementation candidate is 230ed3c6; author evidence fedfca3c is read-only.
`PRESEAL.json` binds literal child recipes, independent expectations, imported
module closure, and every inherited recipe input before the one-shot run.
`driver.mjs` is an explicit opt-in historical verifier, not canonical discovery.

The real worker cannot import literal stubs: its top-level authority call and
hardbound bootstrap consumer/source hashes require genuine admission inputs.
We do not bypass that authority, rewrite bodies, or execute that entrypoint.
Actual body/outer/ledger/supervisor/store/report and loader/bootstrap functions
are composed using synthetic drivers, with no product/comparator evaluation.
Body-to-child and outer-to-body chains are separate so only one supervised
child is active at a time; a fully nested production chain stays unqualified.

All synthetic authority objects have `synthetic: true`, an invalid-for-root
recipe marker, and paths confined to this directory. Twelve PASS rows in the
positive body control are literal fixture data, not twelve real controls passed.
The independent denominator is the declared families, not author counts.

Run once after committing the seal:
`node --unhandled-rejections=strict --max-old-space-size=128 <this-directory>/driver.mjs`
Output uses exclusive new `evidence-01`, never overwrites prior capture.
Child deadlines are 10 seconds, TERM 2 seconds, KILL 1 second. Every handle
has one owner, and all child launches are serial. Candidate's outer allocation
is authenticated statically; small injected body/budget limits exercise
cumulative enforcement without allocating 248 MiB. No full-cap stress claim.

Historical failures remain separate: original author 31/33 and 28 closed
children; r1 2/2 plus 12 negatives is postcapture reconciliation, not replay.
becd1647's 294045 lost bytes and oversized artifacts, old 13/54 versus 47/54,
W07 unqualified/consumed tokens are not repaired or rescored by this review.

The final report must distinguish real source findings from harness defects,
retain failed fixtures, record process closure and postsettlement resources,
and leave real engines, real admission and root readiness to the parent.
