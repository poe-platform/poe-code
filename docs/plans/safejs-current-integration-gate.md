# Current SafeJS integration gate — September 9

The maintained command `npm test --workspace=@poe-code/safe-js` completed with
exit 1 (e681a0). It ran the native npm pretest stages, including all 100
filesystem type-contract checks, then the package source/adversarial unit
selection. It used the current working tree, not only committed sources.

Source/test fingerprint before, during and after the run:
`2c863fca176ef8f21f6d20380175a9705d0cbaae119090f931d3369baec73c18`.
The final match is recorded in 515442. The fingerprint is the sorted per-file
SHA-256 list for `packages/safe-js/src` and `packages/safe-js/test`, hashed again.
The isolated time-duration-total helper is outside this tree and this run.

Results: 25,833 passed, five failed, 41 skipped; 1,041 files passed, four failed
and two skipped, across 1,047 files. Duration was 736.89 seconds. This is not a
passing full-package gate and does not establish full JavaScript conformance.

## Failures and disposition

| Failure | Evidence | Next action |
| --- | --- | --- |
| completed replay, 128 draws | run.completed-replay.test.ts exceeded 5,000 ms | Reproduce/profile the unchanged workload; do not increase its timeout or reduce its width/replay count |
| native Promise own string descriptor | Imported label descriptor was undefined | Resolve explicit property admission without exposing host metadata |
| native Promise user symbol property | Imported symbol value was undefined | Same admission-policy issue; do not blindly copy async-hook symbols |
| regex compile historical checkpoint | Actual intrinsic set additionally contained Temporal | Explicitly enumerate Temporal while retaining exact legacy graph and intrinsic-reference validation |
| Math.f16round historical checkpoint | Same missing Temporal addition | Same narrow expectation correction |

The shared legacy-graph helper already verifies that each additional intrinsic
was absent in the old checkpoint, has a proper reference, and resolves to its
exact intrinsic identity. The correction adds only `Temporal` to the two
explicit lists; it does not replace exact equality with subset checks, change
legacy fixtures, or discard graph/metadata assertions.

Promise admission remains described in safejs-host-promise-import-policy.md.
No production property-copy behavior was changed during this gate. Other
independent work remains available; this issue is not a global impasse.

The main source was kept unchanged until the run terminated. Follow-up changes
invalidate this fingerprint as a description of newer code; subsequent focused
passes must not be presented as a rerun of the full gate. No push or release.

Follow-up 547666 passed 82 historical-checkpoint/Temporal snapshot cases with
one skip after the two explicit Temporal additions. Scoped lint 45d3fd passed.
The unchanged completed-replay file reproduced its 128-draw timeout in focused
check e677ff (seven passed, one failed). The width, three replay iterations,
host-call assertions and 5,000 ms timeout remain unchanged. Profiling targets
that exact four-run workload before selecting a production repair.

Wrap-up revalidation: the unchanged completed-replay file passed all eight tests
in ea3904 (8.21 seconds overall, 5.08 seconds total test time). This does not
invalidate the earlier focused timeout or establish a performance fix: no runtime
change was made between these observations. Treat the timeout as timing-sensitive,
and require repeated baseline/candidate measurements of the unchanged workload
before retaining an optimization. Existing descriptor-scan experiments documented
in safejs-intrinsic-descriptor-scan.md already rejected bulk descriptor capture;
do not repeat that candidate merely because descriptor work appears in a profile.
The two Promise import failures remain unresolved, and no full gate was rerun.
The staged safe-bash patch fingerprint remains
`5aef205cd9aba8165a9884b97907573239bdeb26`. No push or release was performed.

## Post-Duration-method full run — terminal result unavailable

Started another maintained `npm test --workspace=@poe-code/safe-js` run after
Instant locale formatting and Duration total/compare/round integration.
Source/test fingerprint 28cb31:
`f2834179519887acd7b333cf145aea2812a0bd86a2a018e656fbbfd4eff7d65e`.
Session 43079 was confirmed live in b827b8. All four filesystem type-contract
combinations passed (100 contracts total); the package test selection is running.
Do not edit main source/tests until it terminates, restart it because observation
times out, or report partial output as a completed gate. A final fingerprint and
terminal result are still required.

Wrap-up inspection confirmed session 43079 no longer exists and no matching
Vitest process remains. Its final output was lost during context truncation;
neither a pass nor a failure count can be established for that run. The source
fingerprint still matches the value above. Do not treat this run as green.

## Recorded rerun — finished, two failures

After confirming the previous process was terminal, started the same maintained
`npm test --workspace=@poe-code/safe-js` command as session 59210. Output is
retained in `/tmp/safejs-full-gate.sOX0Xu/full-test.log`; the invoking shell uses
`pipefail` so logging cannot conceal a failing npm exit status. The source/test
fingerprint at launch remains
`f2834179519887acd7b333cf145aea2812a0bd86a2a018e656fbbfd4eff7d65e`.
Keep source/tests unchanged until this run terminates, then record its result
and verify the fingerprint again. This is a package gate, not a repository-wide
test result or proof of complete JavaScript conformance. Releases remain held.

Session 59210 terminated with exit code 1 (b4c7fe). All 100 filesystem
type-contract checks passed. Vitest reported 25,954 passed, two failed and 41
skipped tests; 1,049 passed, one failed and two skipped files (1,052 total).
Duration was 537.14 seconds. The only failed file was
`src/interp/promise-import-properties.test.ts`: both the string descriptor and
user-symbol property were absent after native Promise import. This confirms the
documented admission-policy issue; it does not authorize copying private host
async-hook metadata. The replay timeout and historical-checkpoint failures did
not recur in this run. A passing replay case does not establish a performance
repair for the previously observed timing sensitivity.

The final source/test fingerprint matches the launch fingerprint above. The
saved log is the authoritative result, not earlier partial dot output. This is
not a green package gate. The protected staged safe-bash patch still hashes to
`5aef205cd9aba8165a9884b97907573239bdeb26`. No push or release was performed.

## Post-PlainTime and direct Intl admission run

Started the maintained SafeJS package gate as session 40015 (f0803c), with
pipefail and output saved to `/tmp/safejs-intl-gate.R8iePX/full-test.log`.
The source/test fingerprint at launch (6c3984) is
`03b3b7f7e0461e053524257b84f84b8a6acf4357c81d70d3a9d85ab3f45258bc`.
This includes the PlainTime methods and direct Intl format/parts/range input
admission with requested-options persistence. Keep main source/tests unchanged
until the process terminates, then record its final result and fingerprint.
Do not substitute partial output, the earlier full run, or focused tests for
this gate. No commit, push or release is claimed.

Session 40015 completed with exit code 1 (c4153e): 26,225 tests passed, two
failed and 41 skipped across 1,069 files (1,066 passed, one failed, two skipped).
Duration was 640.82 seconds. All 100 filesystem type contracts passed before
unit execution. The only failures were the two native Promise property-import
expectations; no Temporal/Intl or snapshot tests failed in this run.

Final source/test fingerprint matches launch (7b208c):
`03b3b7f7e0461e053524257b84f84b8a6acf4357c81d70d3a9d85ab3f45258bc`.
Saved log SHA-256:
`e5b98177ad7ebc0205f1a7fa57b13181add7d4575587464f0136ef11ff4337e1`.
Protected staged safe-bash patch remains unchanged. The source freeze for this
run is now released. This is not a green full-package gate: the Promise admission
policy remains unresolved, and broader JavaScript/Temporal gaps remain. No push
or release occurred.

Subsequent offset-parser and PlainTime locale changes are outside that full-run
fingerprint. Their focused Node 18/22/26 results are recorded in
safejs-intl-offset-zone-portability.md; they do not establish a new full gate.

## Post-offset and time-zone string integration — failed

Started `npm test --workspace=@poe-code/safe-js` as session 54411 (a99326), with
pipefail and output retained in `/tmp/safejs-zone-gate.K3yJkV/full-test.log`.
Launch source/test fingerprint (d6fa1d):
`0fd82075a416faeaca72bdcd7d4957ef5caef132495577e9774753b04beaf7f2`.
This includes offset component validation and Instant/Duration time-zone string
integration, not just the standalone parser commits. Keep source/tests unchanged
until this handle is terminal; verify the final fingerprint and record the final
counts and exit code. Do not infer a pass from focused tests or partial output.
The two Promise property-import failures remain unresolved. No push or release.

Session 54411 terminated with exit code 1 (765f71). All 100 filesystem
type contracts passed. Vitest reported 26,420 passed, three failed and 41 skipped
tests across 1,074 files (1,070 passed, two failed, two skipped), in 786.92 seconds.
The two native Promise property-import expectations still fail. The additional
failure is the fast adversarial corpus: its internal 750 ms budget was exceeded
at 997.2 ms. This is concrete timing-failure evidence, not proof of its underlying
cause; do not raise the budget or remove coverage to conceal it.

The final source/test fingerprint (26299b) matches the launch fingerprint.
Saved log SHA-256:
`06b9438bbc7aaa10c5d14f066f1a0398be7ff14e1e49101ed16d9051b2418b6c`.
The source freeze for this run is released. No Temporal/Intl test failed in this
run, but this is not a green package gate or complete JavaScript conformance.
The confirmed template/regex parser defect remains unfixed. No push or release
was performed.

### Adversarial timing follow-up

A focused unchanged-source rerun of
`npx vitest run packages/safe-js/test/adversarial/corpus.test.ts` passed
(5b3641): one test, 272 ms test time, 2.54 seconds total. The internal 750 ms
budget and all corpus checks remain unchanged. This establishes that the full-run
997.2 ms failure did not reproduce in isolation; it does not establish a fix or
prove contention is the cause. Profiling under comparable full-suite load remains
necessary before changing runtime behavior or the test structure.

## Fresh post-PlainDateTime integration gate

Started `npm test --workspace=@poe-code/safe-js` as session 33443 (3a070d),
with pipefail and log `/tmp/safejs-integration-gate.yH3SqU/full-test.log`.
This includes current PlainDateTime public integration, rounding corrections,
calendar-string parsing, and Duration relativeTo fixes. Source/tests remain
frozen until this handle is terminal. The two native Promise property-import
failures remain unresolved; no green full-suite claim is made.

Launch fingerprint (617e30), over 1,471 files: recursively all regular files in
packages/safe-js/src and packages/safe-js/test, plus packages/safe-js/package.json
and package-lock.json. Sort paths, then SHA-256 each path, NUL, file bytes, NUL:
`31e8bb8cd27da5ffb6294003639f83f18b98b6248dbe214955581d9fce096c94`.
This fingerprint includes manifests and is not directly comparable to the prior
gate's source/test-only fingerprint. Verify it again when this run finishes.
Do not restart the suite because a poll yields no output. No push or release.

Mid-run check: session 33443 remains live (32c474); all 100 filesystem type
contracts passed (7d85cc), and the 1,471-file fingerprint still matches launch
(aaabe9). Only documentation was edited while this suite ran. No final unit
counts or terminal result are available yet.

### Final post-PlainDateTime result

Session 33443 completed with exit code 1 (13effb): 26,614 passed, two failed,
41 skipped tests, across 1,090 files (1,087 passed, one failed, two skipped),
in 810.34 seconds. All 100 filesystem type contracts passed. The failures are
both in promise-import-properties.test.ts: native Promise own string descriptors
and user-symbol properties are not imported. The earlier adversarial timing
failure did not recur; this does not prove a timing repair. No Temporal test
failed in this run, but neither that fact nor the counts prove full conformance.

The final 1,471-file fingerprint matches launch (9c7089):
`31e8bb8cd27da5ffb6294003639f83f18b98b6248dbe214955581d9fce096c94`.
Saved log SHA-256:
`e77ac331bef198f372242ba086b3ae041cc6da85046b149c2ea00edb387a8b9f`.
The source freeze is released. This remains a failing full-package gate.
Promise metadata admission still requires the safe policy decision documented
in safejs-host-promise-import-policy.md; no arbitrary host-symbol copying was
introduced. Continue independent validated work. No push or release.
