# PAX author handoff — ready for independent review, uncommitted

August 27, 2026 UTC. No staging or commit performed. Root must obtain the
different leaf verifier's acceptance before an explicit-file atomic source/test
commit. This report does not close the historical full archive gate.

## Source policy and primary research

`src/commands/archive/format.ts:146` now classifies the key before decoding its
value. Known optional metadata is limited to nonempty `LIBARCHIVE.xattr.*` and
`SCHILY.xattr.*` attribute names plus exact `SCHILY.fflags` and
`LIBARCHIVE.creationtime`. Ignored values are bounded opaque bytes, not paths,
content, supported charset changes, restored attributes or persistent PAX state.
Everything else keeps strict validation or fails closed. Sparse/layout/type/
volume keys and unclassified ACL, security-label and archived-identity keys
remain rejected. No special-case com.apple exemption, blanket vendor ignore,
base64 padding assumption, replacement-character decoder or runtime dependency.

Existing checksum, octet framing, size, path/link, type, pending/orphan, resource
and signal checks remain. Optional records still count against existing limits.
`src/commands/archive/README.md:120` documents the policy, no restoration claim,
ordinary AppleDouble members, and the separately open empty-value concern.
See `POLICY.md:1` for exact scope and all test-refactor rationale.

Consumed BOTH independent research files before the final policy decision:
`/tmp/safe-bash-pax-research-checkpoint.txt` and
`/tmp/safe-bash-pax-research-detail.txt` (final SHA256
ced5732c0f28c92821c734e7996ff23cce79bfbeed37af915c9d898646e26247).
Primary POSIX.1-2024 page was also browsed/directly retrieved by this author;
official libarchive v3.7.4 reader/writer/manual were inspected. No secondary
format authority, package download or prepare-oracle execution.

Pinned primary bytes from the independent research, retained in
`/tmp/safe-bash-pax-primary-sources/`:
- POSIX pax HTML: 398b008eab3110cd482eee2e62797adaf915405e488b1f36bc73fc2a29591efb.
- libarchive reader: 903f5dd2ff84ec6817af83b475e9086f7b92391280d0927e720ff0dbbb015fa3.
- libarchive writer: 2a9f848bee2e2e64a40a2d6247e24fa185f6b3a537fd38c77c27bd66aabb7d57.
- libarchive tar.5: 9e477ebe3f4502ece6af78fd7a88a14e04f8155cf6db40479cf9797324558e34.
- libarchive tag commit: 313aa1fa10b657de791e3202c168a6c833bc3543.
- Apple libarchive-160 reader: 9e84778492ffa658200854a4104cf0db1d95804a1828184b4172627a50d390af,
  commit e6f2f0739fd3ce7207a2b6955d50fbc0141e1080; this is corroborating source,
  not proof of a reproducible build of the host dylib.

## Focused result and causal comparison

Commands actually run from the repository:

```sh
node tests/commands/archive-stress/pax-extensibility-evidence/run-focused.mjs baseline
node tests/commands/archive-stress/pax-extensibility-evidence/run-focused.mjs candidate
node tests/commands/archive-stress/pax-extensibility-evidence/run-focused.mjs final
git diff --check -- src/commands/archive tests/commands/archive tests/commands/archive-stress
```

Final raw evidence is `final-HFChdx/evidence.json:1`, SHA256
db4673a5bc9ac058671ceb2a51057350f29d3ba43102630087de395e7ec5aa06.

| Cohort | Pass | Fail | Skip | Meaning |
| --- | ---: | ---: | ---: | --- |
| Same final tests/closure, historical format.ts | 4 | 8 | 0 | Counterevidence, not passing coverage |
| New targeted tests | 12 | 0 | 0 | P01–P11 semantics; P12 native-profile control |
| Original native stress IDs | 4 | 0 | 0 | Subset of original30, with disclosed mtime assertion refactor |
| Pinned GNU author oracles | 5 | 0 | 0 | Subset of original128 |
| Existing H01–H03 hardlink tests | 3 | 0 | 0 | Subset of original30 |

All cohorts have zero cancelled/TODO. The four patched-source invocations are
24 focused test cases, not original128+30 acceptance; one is a native-only
profile control. Do not add overlapping subsets to the future combined gate.
Scoped archive/stress TypeScript exits0; diff whitespace check exits0.
NO global build/typecheck, full author128, original30, default wiring or package
suite was run here. The independent verifier owns the requested broader gate.

The final source-only comparison copies the SAME 521 sealed inputs twice as
regular files; exactly `src/commands/archive/format.ts` differs. The comparison
baseline uses f845dd0d728b74576c3e830eabff28a37f673893's accepted format bytes.
The eight failures reflect the one parser restriction and resulting error
ordering, not eight separately claimed product defects. Baseline logs and
native artifacts use a distinct `baseline-native/` directory, never overwrite
the patched-source results, and are excluded only from the author gate's success
predicate as explicitly labelled counterevidence.

Earlier new runs remain immutable: `baseline-8VUfLi` targeted5/12, original
native3/4, GNU5/5, hardlink3/3, scoped types exit2 (new spawnSync harness typing);
`candidate-Bwgncp` targeted10/12, original native3/4, GNU5/5, hardlink3/3,
scoped types exit0. Candidate failures exposed the P07 diagnostic fixture and
BSD AppleDouble listing-profile assumption. POLICY documents both corrections
and the later narrowing of the preliminary ACL/security-label allowlist.
They are not silently relabelled product passes or summed across reruns.

## Native results and remaining distinctions

The exact pinned GNU binary is copied into the snapshot at
`tests/commands/archive/.oracle/gnu-tar/1.35/bin/gtar`, GNU tar1.35, SHA256
49a0bd353ad67347674d00a7b3eeb171da58728f7e4577c9b320d8ab1e7bba66.
BSD is `/usr/bin/bsdtar`, bsdtar3.5.3 with libarchive3.7.4, SHA256
bdccb76a715fbebc4915a1a1b1de0e7050ad842ebb730c47935b3a22c13e3af9.
Native defaults and explicit PAX formats, both plain/gzip and both directions,
are exercised without xattr/copyfile suppression. Inputs are deterministic
byte patterns. Independent native listing/extraction supplies raw-member
expectations; no expected content comes from product output. P09 additionally
extracts both unchanged historical failing BSD artifacts, including binary
SCHILY provenance and unpadded LIBARCHIVE base64 metadata.

Nonempty mtime: P08 and original N-in now assert the unchanged standard expected
times on VFS. P12 asserts exact independent native profiles: local
1700123401125ms for both; following-file GNU1700123400000ms versus
BSD1700123456000ms. Original native observations and `nativeMatchesPosix:false`
remain in `native-BSD-in.json`; no sampling-derived time, tolerance, clock
calibration or virtual-mtime source change. Exact native assertions moved to
P12, not deleted. The independent investigator's V01–V07 fixtures also establish
local nanoseconds and the BSD global omission; native raw reports remain at
`/tmp/safe-bash-pax-native-evidence.json` SHA256
40c862fc8c9045abe4a549c2edfed0264f8b0d650ef64bd99c3469bf31ba4c71.
Its supplement SHA256 is
622f4811807dfec82ac5763afd6486ea16059e2d7bcd26833cb1d6eb3a8c51e5.
The nine research inputs/18 profile pairs are separate, NOT extra product tests.

OPEN deletion concern: investigator V08/V09 and primary POSIX text identify a
base-field deletion versus raw-fallback concern in accepted code, plus genuine
GNU/BSD disagreements. No product runtime deletion claim or expectation change
is made here. Root must assign the separate semantic decision; the nonempty
mtime result is not universal PAX precedence approval.

OPEN native presentation difference: default BSD consumes/hides AppleDouble
`._*` members. Virtual tar preserves those ordinary members. P11 compares EVERY
raw member/sidecar byte against GNU's default reading of the same unfiltered BSD
archive; four `GNU-BSD-raw-*-presentation-control.json` artifacts explicitly
record `presentationMatches:false`. Default BSD's four-name listing is also
asserted and retained. This is raw-member interoperability, NOT native macOS
metadata restoration or identical default BSD namespace/listing presentation.

Actual hardlink identity remains tested: H01 verifies shared scope/dev/ino,
nlink3 and shared write/append effects; H02 rejects missing method/false
capability without copy fallback; H03 protects external VFS names. P10/P11
also check native/virtual hardlink pairs and shared changed bytes. No source
hardlink behavior changed. No xattr/ACL/flag/ownership preservation, no rollback,
no privacy from advisory permission modes, no identity lease/path-race defense,
and no unlimited/bomb-proof/universally cancelling extraction is claimed.

## Frozen identity and reproduction

Final start 2026-08-27T01:59:39.255Z; seal01:59:40.053Z; finish01:59:45.685Z.
6,430ms within the 900s gate cap. Recorded HEAD before/after:
29a61222a8744ce479601ff33061a38b4a193b78, descendant of known root33347b7.
User's known56 defaults are context only, not a hardcoded workflow assertion.
This is CURRENT DIRTY working-input validation, NOT clean committed-HEAD proof.
The seal includes this uncommitted archive patch and concurrent structured
source changes (input/interpreter/jq/numbers/parser/values) as transitive runtime
inputs. Those unowned changes were only copied/hashed, not edited or tested as
their own cohorts. Subsequent moving HEAD b9187c0f601c278b334f5a391d552c38c433444c
was observed after the gate; it is not the validated revision.

Retained current snapshot: `/tmp/safe-bash-pax-focused-fhgalf/snapshot-1`.
Retained source-only baseline: `/tmp/safe-bash-pax-focused-fhgalf/baseline-format`.
Earlier snapshots: `/tmp/safe-bash-pax-focused-VzYdub/snapshot-1` and
`/tmp/safe-bash-pax-focused-Z7mDms/snapshot-1`.
All copies regular, single-link, distinct from live source inodes; no aliases,
hardlinks, git worktree or live Shell/FS/bytes imports. Runtime fixtures include
the historical BSD archives as explicit copied inputs. Evidence/output trees
are excluded from recursive copying. Host Node/OS/dylibs remain external.

521 inputs =156 source +318 existing dependency +47 harness/package/config/
oracle/fixture inputs. Ordered {path,bytes,mode,sha256} manifest SHA256:
3e3e8039e41e263fa13f2438b38fac58ecb73c7917f8d6aff5733d0b47ca9bcb.
Source subset:41aa138c8e3b504b04f63beaad4f7300a003e6a4757c0ed67c9ad82276f28f85.
Archive subset:2c586b9b1baad5c488149b59f4747fff2f11e31c529ee78e10ac135dcb129ec0.
Source-only baseline:6881d66e6c19ac5b48d26ea06f8ed4ff5a832f295512c82260f6c7f6496d7d3d.
Dependencies:3349458b39516888c0586101279f0511b3058167c03379a1f0e99f28eb1dc20a.
ALL318 dependency hashes also match the previously reviewed final archive
snapshot; installed versions match current lockfile records. Node22.22.2,
tsx4.23.12, TypeScript5.9.3, @types/node22.20.1, esbuild0.28.2. No install.
Before/after frozen inputs, moving copied inputs and90 historical evidence files
match. Historical evidence manifest hash before/after:
823de8a517a8b8608e437b52de1d0c3f16f4b3428d8479a4409775cc5207216d.
Old long-link SHA256SUMS remains immutable and describes OLD source bytes;
its format/README entries are not advertised as matching this intentional patch.

Each test process uses strict unhandled rejections, tsx, concurrency1 and a20s
default test timeout (explicit longer native-test timeout inside the test file).
Outer test subprocess cap120s, scoped types90s, version commands5s,
captured output16MiB. New native children have8s/2MiB caps, owned detached
groups and private temporary extraction directories. Loader overrides cleared.
Final commands report own groups absent; no timeout/output-cap/cancellation.
All21 new native temporary roots across the three runs were freshly checked
absent. Old harness fixtures clean in sealed copies. Only owned children were
managed; no broad process cleanup or snapshot deletion. Runtime snapshots and
executables remain outside the proposed commit.

## Review surface and hashes

Modified source/docs and original test:
- src/commands/archive/format.ts:149 — 4e3c6fe95a6b967cf45bfd7b6903fd2e8b568233de33182e2e5af4424b79cfe0
- src/commands/archive/README.md:120 — ec814681a5fc5c5a341b4a7fb15cb8afe460378df9a905c849254fe73cf92ef1
- tests/commands/archive-stress/native.test.ts:104 — 8637e372c0955286bbec9fc1aa9b9465740e212fdbdabb4e31cb272154a10431

New tests/harness:
- tests/commands/archive-stress/pax-extensibility.test.ts:40 — 6be4fac35f4d4ee65e25dce8a605839d02527f3129bdcd22d2dd3b640bee3951
- tests/commands/archive-stress/pax-native.test.ts:76 — 571d416be1d62e9d853d9128fdaa753a2472b0df4798c20fd4cae46d5f17aea4
- tests/commands/archive-stress/pax-extensibility-evidence/run-focused.mjs:86 — 4c009a7232fdde04ba40d55c1f0c40272e911d5fe4f1ff2d1d936849637dbaac
- tests/commands/archive-stress/pax-extensibility-evidence/tsconfig.scope.json:1 — a2c697270bab393f8251cf36a6a2e5b5b722ee71bd2a7ac66813e3f46d15c3e2

New policy, this author report, new raw runs and an exact SHA256SUMS manifest
under pax-extensibility-evidence complete the proposed review surface. No other
production, author fixture, package/lock, registry, FS, jq or root-doc edit by
this worker; no branches/subdelegation. Staging was empty at handoff inspection.
All historical15/18,17/19, attributed Curie365/111, own17/128 with111 duplicate
failures, fixture-only128/128, long-link2/4→4/4 and final158/159 remain intact.
No rerun, scenario, native profile or baseline is silently added to those totals.

Ready for independent verification, NOT commit authorization or global green
acceptance. Root should review the disclosed P11/N-in fixture changes and open
deletion concern along with the narrowly scoped parser patch.
