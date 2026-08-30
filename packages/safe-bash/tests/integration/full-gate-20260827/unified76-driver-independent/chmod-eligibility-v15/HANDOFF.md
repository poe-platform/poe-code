# Native chmod eligibility diagnosis — strict HOLD retained

Artifact/source-only review, August28,2026 America/Chicago. Questions sealed at
`05b549529e7f8cd4b21af1635c5e62542e10decb` before deep inspection.
Attempt `55db52a45e583017fba50c02ad64bddce2feb251` consumed authorization
`c222e17c4cbcc6bcb9da8a77414b90af3c465d88`: **one launcher, exit1,0/14 phases**.
No candidate bug or unique OS-denial cause is proved. No rerun is authorized.

## Bindings and exact failure

Packet52e83606, source02a50600/reseal96daebc0 remain the accepted immutable
bindings. Candidate `f5e9fc49b6abb38e180cc9de16c95fced102ff75`; driver
`2db94b8bf54405e5713b103bd677c873fcc0b153454b3deed13ee8ab4e90583e`;
profile `8c9363ea17f6a319acc783b1e7ec2a4d4dc0a00529692b9f2331f60571ab149f`.
All eight committed gzip/raw hashes validate (19,061,272 decoded bytes).
Authorization bytes match recorded SHA256
`6c04ed4badd458d74f8d1c8c4dd945e55cdd087b90b7d49f097aa2338fae524d`.
Full commit/source/capture identities are in DIAGNOSIS.json; no live fallback.

Raw `inner-REPORT.json` records51 native identity assets with no admission issues,
36 staged executable copies and successful source/history setup. **51 identities
are not51 semantic tests; this is not49/51.** Earlier metadata/archive prerequisite
assertions passed by control flow, not a separately retained full command table.

Shipping `launcher-v3/execute.mjs:74` awaits the inherited adapter. Fixed
`tests/integration/full-gate-20260827/combined-8670ebe8/prerequisites.mjs:26`
imports the canonical oracle assessor; line27 imports archive/fixture assessment.
Line39 calls `fixtureAuthority`; line40 throws on its two returned issues, before
byte setup41/privateState54/engine copy70 and before any phase/build.
Helper SHA256 remains60ae62f6bab6e0348288cd04a6f69c551ce13769bd7ea9e47fb251b9a9dfa2db.

Assessor `tests/plugins/qualified-current-release/prerequisites.mjs:80` loops
exactly `2755` and `6755`. Source identifiers are `(kind=native-fixture-authority,
mode=2755)` and `(kind=native-fixture-authority,mode=6755)`, not product test IDs.
It creates fresh regular files at82, invokes native chmod84, then compares actual
status/signal/error and final mode87. Both attempted commands are:

`/Users/kjopek/Workspace/safe-bash/tests/commands/metadata-stress/.oracle/coreutils-9.7/src/chmod <2755|6755> <temporary>/native-tmp/authority-<2755|6755>`

`<temporary>` is `/private/tmp/unified76-os-write-HzSPPY/tmp/unified76-execution-IO6zT7`;
cwd is its `source` directory. Recorded binary SHA256:
`3b7a9b5819dd93eff18b25dfbbac1c1d17e2ccd419368da90b366653b1b1cbd2` (GNU9.7).
Each command returned1, signal null, empty stdout, native stderr ending
`Operation not permitted\n`. No spawn error is serialized; the source drops
undefined `error?.message`. No per-probe PID, syscall or numeric errno is recorded.

Both targets: uid501/gid20, regular/non-symlink, **0644 before and after**.
The initially gid0 native-tmp directory was normalized to captured member gid20;
umask022 and successful ACL listing are recorded. This is not demonstrated
nonmember-GID failure. Endpoint modes do not prove absence of transient effects.

`tests/plugins/stream-five-public/harness.mjs:10` supplies explicit child env
`PATH=<Node24 bin>:/usr/bin:/bin,LC_ALL=C,LANG=C,TZ=UTC`; run14 uses180s/32MiB.
This is source-defined, not a serialized per-probe env record. Absolute chmod
bypasses PATH selection. Its explicit env replaces, rather than inherits, the
adapter's finite Git routing env; OS fencing still wraps the worker. The adapter
record is failed-callback/restored:true/poisoned:false with no drift/restore error.

## Denial origin: bounded conclusion

Outer receipt binds sandbox-exec, Node worker67506 and rendered profile SHA256
`9fa2711b789d1f8d7cbc83b78a182eb3f83b6644aa1f8bba2568055d24a53faf`.
Recorded setup-worker argv has no Node `--permission`; later phase flags were not
reached. This is a native command failure, not the old bare-Git spawn EPERM or a
Node ERR_ACCESS_DENIED/product assertion.

`launcher-v3/os-instruction-fence.mjs:46` renders the actual profile: ordinary
file writes allowed under the two owned roots, outside/instruction writes and
selector execution denied. These benign target names are inside the allowed work
root. There is no explicit2755/6755 rule or retained syscall/sandbox-denial trace
that uniquely attributes the failure. **Inherited OS fencing versus lower host/
filesystem/setid policy remains UNKNOWN.** Do not infer a capability grant or
change any fence/privilege from this source string and generic diagnostic.

## How many cases depend on it?

- Exactly **two failed eligibility probes for one binary**. The global caller's
  empty-issues assertion blocks all14 phases/632 canonical paths;632 is not a
  measured test-case count. Zero product tests ran.
- No central probe-to-case eligibility registry exists. Three selected canonical
  top-level groups visibly exercise related capabilities: directory setid controls
  at `tests/commands/metadata-stress/chmod-controls.test.ts:10` (48 vectors);
  seeded differential at `tests/commands/metadata-stress/native-differential.test.ts:10`
  (384 vectors,32 setid-setting vectors); member-group success at
  `tests/commands/metadata-stress/permission-profile/qualification.test.ts:8`
  (four native creation/preservation operations across file/directory).
  These are **three identified capability-sensitive groups**, not three measured
  failures or exhaustive dependents. Regular-file probe failure does not prove
  directory/Node chmod behavior. Do not sum vectors as independent TAP tests.
- The older canonical-env registry selects11 paths, expects318 TAP cases and
  records22 named native-prerequisite cases. Two of those22 are the48/384 groups;
  the other20 are not automatically unqualified. `runner.mjs:109` insists on all
  expected passes/zero skips; there is no environment-unsupported selector.
- `tests/plugins/qualified-current-release/prerequisites.test.mjs:62` directly
  re-runs both probes as **one** test, but is NOT in the632 canonical selection.
  `scripts/verify-qualified-release.mjs:59` and the historical combined-b494 helper
  also aggregate the result; they are separate entry routes, not this attempt's
  extra measured cases. The script's unavailable branch gates its whole release.
- Seven `permission-profile-independent/review.test.ts` controls are historical/
  static/simulated, not live setid-success tests. Preserve them and ordinary chmod,
  stat, mktemp, denial and archive-history controls. Two existing Darwin
  characterization cases separately require Node22.22.2/libuv1.51.0; do not claim
  two new eligibility rows exhaust every possible environment prerequisite.

`expectedMode` in the differential is local filesystem readback, not shared probe
data. Affected bodies assert rather than skip. Exact downstream dynamic failure
cardinality is unmeasured; this trace does not certify all remaining cases runnable.

## Minimal prospective choices for ROOT

1. **Keep strict HOLD.** Consumed attempt and current all-assets/14-phase/zero-skip
   gate remain failed; no retry, setid grant or elevated/out-of-fence reroute.
2. If ROOT wants unaffected work, approve a **separate named environment-qualified
   profile**, not an old-gate success. Retain exactly two eligibility rows with
   original command/status/stderr/identity/effects and distinct
   ENVIRONMENT_UNSUPPORTED/UNQUALIFIED classifications. Identity51 remains a
   separate table. Dependent test groups need explicit blocked/unexecuted reasons;
   unaffected actually executed results get their own denominator. No blanket
   chmod exclusion, false skip-pass, rewritten expectedMode or old rescore.

There is an existing structured seam: fixtureAuthority returns issues/probes and
writes its JSON before the frozen caller asserts. Existing authenticated records
can support the prospective unsupported classification without repeating denied
commands. **Catching and ignoring helper40 is insufficient:** it returns no result
and never completes byte/SafeJS setup. The maintained driver owner must author and
rebind a narrow additive setup/profile orchestration separating eligibility from
independently required remaining stages and explicit test selection. Preserve the
frozen assessor/helper/bodies, other guards and real statuses; do not clear issues,
mock subprocess success or fabricate `safejs` state. No implementation is supplied
here. Private/setup/historical guards may independently block later work.
Current `policy.mjs:60` still requires complete binding/guards,14 outcomes and
zero skips; a partial profile must not report its QUALIFIED_ZERO_SKIP_GATE.

## Closure and retained state

Worker67506 exited naturally1 after71,302ms, no signals/timeouts/overflow or
recorded survivors. Phase-protocol/aggregate fence cleanliness is FALSE:0 expected
phases completed, final sweep absent. This is not full-gate cleanup completion.
Private would-copy metadata admission occurred, but privateBefore/privateAfter,
engine copy and final product/package/private guards did not. No clean-private
postguard claim is valid.

Read-only lstat at11:17:14Z confirms retained output/outer/work/temporary roots;
probe inodes181484102/181484103 remain regular16-byte0644 files. SETUP-COMPLETE,
safejs-engine and the exact six projected instruction paths are absent. These
endpoint absences are not universal no-copy/private-state evidence. No retained
root was changed, read for private/instruction contents, or cleaned.

Old8e6/df89 and original unknown EPERM,99684045 failure,5bec continuation,
unsupported E03.3 and bound-only A10/package/protection evidence remain separate.
This reviewer ran only permitted metadata reads, not native/helper/product code,
tests/probes or processes requiring cleanup; no signals, private access, instruction
materialization, permission request or new authorization. ROOT owns the profile
decision and any future authoring/execution GO.
