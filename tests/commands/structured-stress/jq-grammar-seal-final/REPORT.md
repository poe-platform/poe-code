# Independent historical seal review — August 27, 2026 UTC

## Pre-application verdict: APPROVE

This independent reviewer did not author the proposal and used no delegation.
Approve only the exact 43-line afterSnapshot for
`tests/commands/structured-stress/jq-42-review-fixes/evidence.test.ts`.
The canonical test remains unapplied at this evidence checkpoint. Application
authority is the user's explicit conditional authorization after this approval.

| Pin | SHA-256 / commit |
| --- | --- |
| Proposal commit | `21d78a4073ce5ab03079985b44888026c45564ec` |
| Exact unified patch | `53e2b083aa7c61444052eebd14428ba5e032500e963eb1b6e5f427806ddaa47f` |
| Original test / dated snapshot | `bc2b19133b926eccf2519885bb5ca7a16f9ce09e1fb1a9cda78b6c365a7710f8` |
| Reviewed afterSnapshot | `81a55856d1ec4dea51676ef09a5aeeb95d3383a7284eb1ec87deef848e430281` |
| Original 139-path manifest | `3766803b4bd8cc39f014e13de881cda034515b1094436530cdfa6505750ce9e3` |
| Approved 13-path migration manifest | `aae89dfeefab84c50ef91a84c1c1608d659c0037ac96eb93c5f828ab32c938ce` |
| Original independent approval | `95966ca2006bfa9bb35353cbac0a14038089c4ba` |
| Native application | `50434b3646d3ba1711be5bb707d44d3bfa201fe2` |
| Host application | `538a7f87ec50140780fa9a58f833e116d876e7c0` |
| Structured source commit | `09926fb67452ca7db9bd793d87b78d2f41ff82be` |
| Structured source hash | `913886e89fce8626d28f957d978243e3b8dd6bf94dd14348f5331f47607b4fb1` |

Source and original target hashes and committed bytes were checked before any
candidate test execution. Every proposal artifact matches the proposal commit.
The unchanged first native-freeze test and imports match byte-for-byte; the
dated original snapshot preserves both original test names and original bytes.

The proposal's actual verifier was rerun successfully under strict unhandled
rejections and a 120-second watchdog. Its complete parsed output equals the
committed verification.json: **352/352**, comprising two candidate tests, two
original tests with historical bytes restored only in memory, the reproduced
original live failure, and **347 rejected mutations**. Counts are reexecuted,
not accepted from the author's report. The exact diff and git apply --check pass.
All 13 paths match their application commits; before snapshots match parent
commits and approval; after snapshots match approval and application. Commit
membership is exactly 12 native plus one host and both descend from approval.

An independently written VM harness executes the actual candidate code with
realistic ENOENT failures, not a replacement seal algorithm: two positive tests
and **514/514 additional negative checks** reject missing/renamed physical
files, missing/extra/renamed manifest entries, changed original hashes, before
snapshot tampering, current/after snapshot tampering, all 129 unlisted old
paths, and dated-test tampering. These checks overlap the proposal mutations;
they are not additional product/native executions or new corpus coverage.
The first reviewer harness attempt omitted native-frozen.json from its virtual
map and stopped at ENOENT before mutant testing. Only the owned harness was
corrected; the unchanged proposal rerun and the corrected independent run pass.

The exact ten old-manifest intersections retain original before hashes and
snapshots plus reviewed current/after hashes. The other 129 old paths remain
exact. All 13 approved current paths and after snapshots are checked, including
three new files outside the old manifest. Whole-manifest byte pins reject entry
changes before parsing; there is no generic allowlist or replaced original hash.
The planned canonical seal is a deliberate fourteenth approved test-only target,
not a rewrite of the old manifest or the independently approved 13-path manifest.

`approval.json` records all mutation outcomes, the exact provenance map, source
hashes, dirty-worktree status and 667 frozen structured artifact hashes.
`proposal-rerun.json` retains the full independently reproduced proposal output.
Reproduce pre-application review with
`node --unhandled-rejections=strict tests/commands/structured-stress/jq-grammar-seal-final/review.mjs review`
in the original pre-application state; it intentionally rejects an applied target
and refuses to overwrite existing approval evidence.

## Historical boundaries

Prior `1d93186` / `2b37b27` evidence remains dated and unchanged: whole source and
compiled 1344/1344 pre/post, changed canonical 427/427, complete structured
3757/3758 with only the stale live seal, and the two final unowned shell type
errors. None is claimed rerun at this approval checkpoint. Original22/30 reds,
baseline94 =45 exact/49 differences, and original42/790 remain intact. This is
only an evidence-test migration, not new native parity, full jq/project closure,
superiority, a clean HEAD certificate, or a 72-hour work claim.

## Final application and bounded validation

- Approval evidence-only commit: `e0c4b72ab3f3f77a8812567f24ac2c56f078bafe`.
- Separate single-canonical-test commit: `c0055e105eb6873281c1a311a4996ca2c6f9fdeb`.
  Its complete changed-path list is exactly the one authorized evidence.test.ts;
  no report, production, fixture, manifest or other canonical file is included.
- The final evidence-only commit is the commit adding this completion section
  and the seven validation artifacts alongside it. Resolve its exact ID with
  `git log -1 --format=%H -- tests/commands/structured-stress/jq-grammar-seal-final/REPORT.md`;
  the final handoff also records the ID. A commit cannot embed its own final hash.

The committed application is byte-exact to the reviewed afterSnapshot, SHA-256
`81a55856d1ec4dea51676ef09a5aeeb95d3383a7284eb1ec87deef848e430281`.
The original native-freeze test remains unchanged. All 667 captured structured
paths retain their bytes except this deliberately authorized fourteenth target;
the prior 13 approved canonical paths, all before/after snapshots, vectors,
native artifacts, fixtures, manifests and historical reports remain exact.
Both immutable manifest pins and the structured source commit/hash above remain
unchanged before/after every validation command. No production edit was made.

| Fresh command cohort | Result |
| --- | --- |
| Exact prior 38-file list, full structured tests | **3758/3758**, zero failures/cancellations/skips/todos |
| Canonical target plus byte-assertion file | **2/2 + 15/15**, included in 3758, no duplicate credit |
| Scoped current structured source and all structured tests, including target | Typecheck exit 0 |
| One global TypeScript check | Exit 2, **14 unowned diagnostics**, retained verbatim |

Tests run with `--unhandled-rejections=strict`, the same explicit 38 paths from
the old post-full-structured.json, a 180-second test timeout and a 240-second
process watchdog. The full run was August 27, 2026, 02:57:18.442–02:57:30.267 UTC;
the global check ended 02:57:38.219 UTC. No native oracle or full1344 source or
compiled rerun occurred. Prior 1344/1344 and 427/427 acceptance remains only the
separate earlier report's evidence. Prior **3757/3758** is preserved, not refreshed.

Current global diagnostics are all in the unowned WebDAV consumer work:
consumer.test.ts:88,109,125 (three TS2353); example.ts:21 (one TS2353 and three
TS7006), :22,24,26,29,31 (five TS2339), :23 (one TS2345); provider.ts:89 (one
TS2722), under tests/fs/webdav/consumer/. No change or rerun was used to hide
these errors. The prior two shell errors remain historical observations; they
did not appear in this new global run. This is not a whole-project typecheck pass.

The worktree and HEAD moved independently. During the full test run the captured
src tree changed at src/fs/s3/COMPARISON.md and src/fs/s3/SDK_COMPARISON.md;
the structured source stayed exact. All before/after product path hashes and
dirty statuses are retained; no clean-HEAD or stable-whole-product claim is made.
There are no remaining failures in this bounded test migration. All reviewer
commands completed, no reviewer-owned child remains active, and no subagents
were created. The final explicit-path commit leaves owned paths clean; unrelated
workers' changes are neither edited nor staged by this reviewer.

Fresh raw TAP, exact commands, timestamps, source/product hashes and diagnostics
are in full-structured.json, target-and-byte-assertions.json, scoped-types.json,
global-types.json and final-audit.json. The local validate.mjs and tsconfig.json
define the reproducible bounded runs; evidence writers refuse overwrites.
