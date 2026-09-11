# Issue 694 follow-up: keep invocation resources private

## Validated regression

The stable release's existing invocation-cleanup lifecycle test failed because
registered command contexts acquired `Symbol(shell value allocation scope)`.
Issue 694 correctly forwarded the allocation scope through internal redirect
IO to preserve raw inline bytes and budgets, but normal dispatch removed only
the invocation-cleanup symbol before constructing public contexts. The failure
is deterministic, not a cleanup scheduling race: null cleanup registration and
late registration still reject as intended.

The unchanged failing test was reproduced in
`/tmp/poe-694-cleanup-repro.log`. Added memory-only controls recorded five
failing tests in `/tmp/poe-694-private-boundary-red.log`, covering direct
commands, functions, context.invoke and executable VFS env shebang dispatch.
The shebang path additionally exposed the invocation-cleanup scope by spreading
an internal incoming context into its public middleware/interpreter context.

## Minimal correction

Normal dispatch deletes the known private value-scope key from its fresh
public-IO copy. It restores that scope only on the separate internal context
used by builtins and functions after middleware; no previously exposed object
is modified to add authority. Registered commands continue receiving the public
forwarded context. Internal redirect IO retains the allocation scope.

Shebang dispatch removes both known private keys from its fresh public context
before middleware, while its separate child IO retains the invocation's internal
resources. This is not blanket symbol stripping: host-owned metadata is not
removed. No public cleanup, invocation, ownership or raw-byte contract changes.

The tests retain middleware contexts and inspect them again after execution to
exclude late scope attachment. The original synchronous-registration assertions
remain unchanged. Native files are not created: executable scripts use the
memory filesystem.

## Validation

The focused lifecycle/parameter-transform/heredoc/shell-IO/select cohort passed
215/215 in 2.45 seconds (`/tmp/poe-694-private-boundary-green.log`). It covers
the private-context fixes alongside the raw inline paths that require the
internal scope. Initial strict checking found an optional invocation-method
annotation in the new fixture; the test now explicitly uses the shell-provided
method, preserving runtime behavior. Final strict checking is recorded in
`/tmp/poe-694-private-boundary-types-final.log`.

The root coordinates independent public-consumer checks, rebuild, guarded lint,
atomic commit and release monitoring. The interrupted previous lint run is not
a passing gate. This repair is separate from the pending select feature even
though both are present in the working runtime file.


## Final integration gates

After the private-context correction, the maintained normal build passed
(`/tmp/poe-693-final-build.log`). The refreshed candidate at
`/private/tmp/poe-693-final-komeyey_` passed 122 checks each on Node, Bun,
browser and actual workerd: 74 parameter-transform checks and 48 select/public
boundary checks. All three strict public type profiles passed, as did the
45/44-input browser/workerd graph checks. Retained middleware contexts remain
free of private symbols. The root inspected the representative select menu
screenshot at `/private/tmp/poe-693-public-m78ufcq6/screenshots/node-demo.mjs.png`.

The final maintained `npm run lint` passed in 169.41 seconds: all 10,518
configured files, zero errors, zero warnings and 25 receipts, followed by
successful type and workflow checks (`/tmp/poe-693-final-lint.log`). No
repository files changed while the gate ran. The earlier 144.25-second lint
run was deliberately terminated for the validated private-context repair and
is not counted as a passing gate. These local checks do not establish release
publication.
