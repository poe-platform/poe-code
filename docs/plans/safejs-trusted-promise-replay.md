# Trusted promise replay indexing

The full subclass-candidate package run exposed two existing workflow failures:
external-checkpoint-validation and ppr2-integration-adjudication both rejected
the co workflow while capturing its public checkpoint. Final run: two failures,
19,558 passes and 41 skips in 453.83 seconds. Neither failure was a timeout.

The failure is in the pending-promise admission guard delivered by 0a2d8e36e:
public dump heap indexing calls low-level capture before the existing trusted
run-replay serialization path can retain unresolved runtime metadata. Low-level
and arbitrary-input snapshots must still reject unrepresented continuations.

Pass the existing in-memory snapshot trust decision through heap indexing and
avoid low-level guest capture only for trusted unresolved promises marked as
unrepresented. Keep the ordinary runtime metadata path and replay/reconciliation
contract unchanged. Do not grant trust based on serialized fields or source data.

Both failing workflow files plus replay policy and low-level admission checks now
pass: 61 tests in 9.71 seconds. A direct boundary test also checks that copying a
trusted snapshot and adding a trustedRunReplay field does not transfer authority.
This regression fix will be committed separately from subclass continuation
support. The subclass worktree changes must be preserved, not bundled into it.

The direct boundary test passed together with those existing workflows: 62 tests
in 8.41 seconds. Copying the trusted object, even with an explicit trust-named
field, is still rejected. Final lint/build/delivery verification is pending.

Changed-scope ESLint and the maintained 70-workspace/root build passed. Fresh
SafeJS ESM imports passed. The real CLI subclass harness passed and its PNG was
viewed; checkpoint correctness itself is established by the 62 focused checks,
not by that CLI smoke test. The checkpoint fix is ready for its separate commit.

Remote CLI run 34161862592 failed the same two co checkpoint cases plus two
5000ms Float32 camera timeouts (36,350 passing tests). This change addresses only
the checkpoint regression; it does not claim the camera timeouts are resolved.

Delivery: 7b55163a8 is verified on remote main and published as
@poe-platform/safe-js@0.1.399 by run 34163119749, receipt
2026-09-07T21:30:26.5613429Z.

The next full package rerun exposed three completed resolver replay failures:
two promise-resolver-metadata cases and the completed withResolvers replay case.
It finished with 19,558 passes, three failures and 41 skips in 415.46 seconds.
The fallback was applied to promises carrying an observer flag even after they
settled, changing their node kind to object while their resolver still required
a guest-promise target. A direct test reproduced object versus guest-promise.

The follow-up now limits fallback to promises whose live state remains pending.
A second direct test reproduced a pending resolver node pointing into that raw
metadata path; indexing now treats that resolver and its target consistently.
Settled promises retain guest nodes, and arbitrary/copy inputs remain untrusted.
All 87 resolver, withResolvers, co checkpoint, policy and admission checks pass
in 6.64 seconds. This follow-up remains uncommitted pending lint/build checks;
it must remain separate from the subclass change.

Follow-up verification passed: changed-file lint, the maintained 70-workspace
build and root suffix stages, and fresh ESM imports. Node 18 completed resolver
replay preserved [7,42] and kept its host read count at one. The real CLI subclass
harness saved and resumed /tmp/safejs-resolver-replay.2cUkb0/checkpoint.json;
both runs passed and both screenshots were opened. Zero spawns were expected;
this checks the actual runtime/CLI replay route, not model behavior.
