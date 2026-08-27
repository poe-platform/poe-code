# Bounded independent schedule, fixed before handoff

1. Verify author-ready identity, all 20 historical snapshot hashes, immutable
   fixture and unowned helpers; archive source/test hashes and author marker.
2. Run tiny independent negative guards once each, using the reviewed author
   helper with explicitly saved controlled-child mutations where necessary.
   Preserve failures; stop on a substantive finding and ask root before more.
3. Run the original-path canonical jq file once (15 cases/330 triples), then
   original-path streaming wrapper once (its six-case child/pass6 assertion).
4. Run **two** concurrent rounds, alternating launch order: jq canonical file
   plus direct original-path streaming-cases child. Maximum three processes
   including rg, excluding the verifier driver. Do not concurrently add the
   streaming wrapper: it adds a fourth child. Root was notified of this
   interpretation; this does not claim concurrent outer-wrapper coverage.
5. Archive post-run identity, exact child/stream close evidence, and report.

Planned positive semantic denominator if all work is authorized and completes:
45 jq cases/990 triples, 18 streaming child cases, one wrapper assertion.
These are repetitions of the frozen 15/6 cases, not new unique coverage.
No fullgate, external oracle breadth, cancellation-policy change, pathological
regex, load generator, or retry schedule. Native profile identification is
one benign `rg --version` call in an isolated review directory. Short negative
bounds are distinct from canonical watchdogs and carry scheduling caveats.
