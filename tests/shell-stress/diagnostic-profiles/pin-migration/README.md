# Two-driver provenance migration

This is a narrowly authorized current-test binding migration, not a new native
baseline or product fix. Exactly two of fourteen historical test/helper pins
change for the current guard; all twelve other pins remain required. The original
native seal, observations, fixtures, helper bytes, and identity/lifecycle control
are unchanged. The current suite still has 72 differential + 5 syntax + 11 gap +
1 identity tests. No assertion, error, oracle result, or file effect is normalized.

`current-binding.ts` records fixed literal historical/current SHA256 values and
their historical-seal and migration commits. `authentication.json` authenticates
the complete old and new Git blobs, parent crosswalk, worktree bytes, complete
committed diff, and the original 89 failed-before-hook rows. The original capture
remains intact; `original-89.tap` is a byte-preserving excerpt, not a replacement.

The sibling drivers changed at `4fa20ac6cadb9d37fa9da4d205dc37a5a1bcb9f9`:
their oracle imports and test labels now name the frozen GNU5.3-primary profile,
uniform `argv0=shell`. This differs from their former live `/bin/bash`3.2 profile
and `shell-stress` invocation name. The sibling drivers are not executed by this
diagnostic suite. Its own two native profiles remain explicit, with live native
replay followed by exact current-product comparison against the historical seal.
Source/profile facts are not automatically inferred from new hashes.

`validateFrozenProfile()` retains historical binding semantics and can replay
with the original driver bytes. Canonical `compatibility.test.ts` instead calls
`validateCurrentProfile()`; both share every original native/fixture assertion.
The additional literal capture hash protects the historical metadata itself.

Before execution, commit the migration, controls, authentication, and runner.
Run `node tests/shell-stress/diagnostic-profiles/pin-migration/run.mjs CANDIDATE execution-REVIEW_LABEL`.
The runner checks its committed inputs, uses regular temporary copies of the
committed source/test tree and installed development tools, and runs the whole89
first under pinned GNU5.3, then historical GNU3.2, without case-specific switching.
It also runs six binding controls, both full89 mutated-driver hook controls,
and a historical guard-only replay. Native commands retain their original
deadlines, environment, original script bytes, and isolated scratch directories.
No dependencies are fetched; no product command launches a native process.

Results must retain semantic failures, exact counts, source/tool hashes, and
cleanup receipts. These author tests are not independent acceptance, full native
parity, a whole-project gate, or evidence about the ten cleanup archive pins or
the separate 84 pre-env-S failures. A different reviewer must verify the frozen
candidate. See `RESULTS.md` after execution for the bounded run and limitations.

`ATTEMPT-1.md` discloses the first author control assertion-matcher defect.
Its unchanged `execution/` logs remain evidence, not successful mutation controls.
The corrected matcher verifies the exact diagnostic first line, assertion code,
operator, literal expected SHA, and actual mutated SHA; it does not change the
guard, native oracle, or any of the89 existing behavioral assertions.
