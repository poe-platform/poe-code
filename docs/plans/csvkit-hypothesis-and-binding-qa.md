# csvkit hypothesis and binding regression QA

Continue the existing implementation without changing its explicit family
registration, historical profiles, README content or Git/index ownership.

1. Reproduce the frozen `duration long s` Shell differential as a hard failing
   test, comparing stdout, stderr, status and unchanged in-memory source bytes.
2. Authenticate Agate's source archive against reference-profile.json and inspect
   TypeTester.run. Compare row/column candidate elimination with the engine.
3. Reproduce direct TimeDelta versus inferred Date-hypothesis behavior in domain
   tests. Implement surviving-hypothesis scanning and remove the direct-cast
   refusal; preserve no-inference and row-limit semantics.
4. Have a separate agent stress mutable factory bindings, all fourteen collision
   positions, candidate elimination, exported environment and input cleanup.
5. Run maintained uncached csvkit unit/lint checks and the safe-bash selected
   build closure; then run maintained CSV Shell tests, runner checks and public
   consumer typechecks. Shared integration also requires repository lint/tests.
6. Record measured results and remaining blockers in docs/csvkit. Python set
   traversal and competing unmeasured hypothesis errors do not acquire parity
   merely from deterministic JavaScript ordering. Explicit refusals, skips and
   TODOs remain outside compatibility passes.
7. Purge only this continuation's temporary evidence after recording results.
   Do not stage, commit, push, publish or add README content.
