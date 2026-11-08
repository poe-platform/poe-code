# Author checkpoint — 2026-08-27

Root-approved bounded fixture/profile qualification is implemented. **Independent
review pending. No production chmod fix or whole-gate-green claim.**

## Evidence first

Commit `9fa86b2fd23525bfa4ab944fef404654ce90c9d6` seals all25 surviving files
(7,812,085 bytes) from `/tmp/safe-bash-darwin-classification-b04J1M` before any
fixture edit. All originals and final-seal hashes matched. Nothing was overwritten
or cleaned before the seal; original temporary proofs remain intact.

Seal manifest SHA256:
`04c1a2c6bf34d1aee529e6e1eb12849e64dec2dfe63be9b9a50f7ed59fa071c9`.

## Qualification delta and vector preservation

Two existing test files receive only the qualified-fixture import/setup and
initial-mode setup calls (6 inserted/3 removed lines). All other test bodies,
comparisons, vector literals, seed/PRNG, file/directory alternation, argv, umasks
and sentinel bytes are unchanged. The generic `helpers.ts` is unchanged.

The new helper first qualifies each owned native object to caller primary gid20
while preserving uid501, then verifies ownership/group/identity. Only afterwards
does `setMode` establish and verify each exact requested initial mode. Failed
preconditions fail explicitly, including unavailable search permission; no skip,
fallback, different group, rollback or assertion relaxation is introduced.

This changes native metadata prerequisites: requested06755 now measures06755,
instead of the archived nonmember-group04755 setup. That difference is disclosed;
the original17 failures remain sealed, and no old strict score is rewritten.

`author-qualified-v2/vectors.json.data` contains all384 transition tuples and48
directory-control tuples. Reversing ONLY the explicitly declared prerequisite
source edits restores each entire original b494 source file byte-for-byte. This
proves no hidden command, mode, assertion or unrelated-fixture edits; it does not
claim unchanged metadata inputs.

- Full384 tuple digest: `c2384356b7ad48e37ff8494b375029bdf94b861a4038b6d2f6e9a0b9c9c0a672`.
- Full48 tuple digest: `3fb22152c2b7f4b0830a4110a1cce15207f8457827abeb65877dc993fd4463fd`.

## Author execution and counts

Explicit runner: `node tests/commands/metadata-stress/permission-profile/capture-author.mjs author-qualified-v2`.
Full argv, timestamps and exit statuses are in `execution.json.data`; raw stdout
and stderr are retained separately, with a manifest for all output bytes.

| Scope | Result | Meaning |
| --- | --- | --- |
| Complete seeded cohort | 384/384 transitions; 1/1 test | Native/Memory status and mode equality under verified member prerequisites |
| All chmod-controls tests | 3/3 tests, including all48 setid vectors | Original assertions retained |
| Sealed archive | 2/2 tests |25 original artifacts and17 historical failures retained |
| Fixture qualification | 4/4 tests | Legitimate SGID, unsafe input/replacement rejection and prerequisite denial |
| Darwin divergence characterization | 2/2 assertions | GNU strict gap STILL PRESENT; not2 GNU-parity passes |
| Real permission denial | 1/1 test | Node EACCES, typed RealFS EACCES/path, command failure, exact diagnostics and no child effects |
| Scoped strict no-emit TypeScript | exit0 | Source imports and all six listed TS entry files checked; no build |

Total selected runtime tests13/13; zero failures, skips, cancellations or TODOs.
Other native-differential tests were not selected; no all-metadata or whole-gate
execution is claimed. Profile assertions are not merged into the432 qualified
mode-transition/control denominator or an old strict-profile score.

The earlier `author-qualified-v1` capture is preserved unchanged: runtime13/13
passed, but scoped types found14 optional Node identity-getter diagnostics in the
new tests. Explicit prerequisite guards corrected these; no product source or
comparison assertion changed. v2 repeats the full bounded runtime and type scope
on the final test/helper bytes and passes.

## Profile observations retained

Host macOS26.4.1 build25E253, Darwin25.4.0 arm64; Node22.22.2/libuv1.51.0.
Caller uid/euid501, gid/egid20; groups20,12,61,79,80,81,701,33,98,100,204,250,395,398,400.
Process umask022. GNU9.7 SHA256:
`3b7a9b5819dd93eff18b25dfbbac1c1d17e2ccd419368da90b366653b1b1cbd2`.

Fresh unqualified owned `/tmp` directories genuinely inherited uid501/gid0:

- Requested initial06755 measures04755; `-- +2000 directory`: GNU1/04755,
  raw Node/direct RealFS/command RealFS0/04755, MemoryFS0/06755.
- Initial0051; `-- ug+s directory`: GNU1/0051, raw Node/direct RealFS/command
  RealFS0/04051, MemoryFS0/06051.
- GNU stdout empty, stderr exactly
  `chmod: changing permissions of 'directory': Operation not permitted\n`;
  native failure preserves captured metadata/ctime. Other layers' output is
  empty; Node/RealFS successful operations update ctime. Sentinel00ff0a and
  namespaces remain intact. Group0 is never assigned or made a member group.
- Normal search denial preserves child mode0600/ctime/bytes and typed RealFS
  FsError(EACCES) at `/work/blocked/file`. GNU and virtual diagnostic bytes remain
  individually exact and explicitly unequal, not waived into byte parity.

These are declared host-profile observations, not Linux or OS-universal claims.

## Final consumed source hashes

| File | SHA256 |
| --- | --- |
| `../chmod-controls.test.ts` | `f93d92ce384307a5226ad85b27cdf74da1d2026125d14e575109e661eb56c02c` |
| `../native-differential.test.ts` | `eb0c185f1ccef217971faeac4394150695b8f47c4906d01c0367f7094b16b999` |
| `fixtures.ts` | `659652208d50a185f52ecb5c220c296a2056e07cd686da39db79ba30771b856b` |
| `archive.test.ts` | `8a1d82619e3a179748431d6204ecd47dec09fe6e9358b0c549f4c5f82a0a6200` |
| `qualification.test.ts` | `182f4e56f18a20414811589d91d4cd25db7196101d063353942df38158c50084` |
| `darwin-profile.test.ts` | `33290f649220fa0affd8b1f2e3d290c1f857c0f0e739531d5665c09b288dfa52` |
| unchanged `../helpers.ts` | `cb70e69c261db9e634ce5afe6b6661139f63dbe489c1044853a083ba2020acd2` |
| unchanged production chmod | `9286ebc9bea074bf9dad58cb6197aa5e10d325c549187eefbc9203ac76b09cfd` |

All958 inventoried source/dist/config/test/seal/oracle files were identical before
and after v2 execution, digest
`2c7d6b6fea40a04cb9ad114acadcb1e72f29a1212a43a4697880f2b46898d863`.
Validation observes HEAD36e55ef94bc11deb785c90700e6b20cabc6786d0 plus the explicit
owned qualification changes; this is a hashed dirty-candidate author run, not a
historical clean whole-product gate. The subsequent qualification commit carries
these exact checked source/test/helper bytes. Concurrent unrelated owner changes
are excluded from the commit, not reverted or claimed validated.

## Cleanup and review handoff

v1 and v2 leave zero metadata `.native-*` roots and zero owned Darwin `/tmp`
profile roots. Each recorded native profile path is verified absent, and all
child executions settled. No source build, native build, dependency change,
production/root-config/contract edit, private-checkout access or global group
change occurred. Pre-existing other workers' native artifacts are untouched.

Reviewer focus: group/uid/entry preflight ordering; exact-mode verification after
chown; full384/48 vector preservation; sealed historical distinction; inability
paths fail rather than skip; profile characterizations do not count as GNU parity;
typed denial and sentinel/ctime preservation; final source binding and cleanup.
