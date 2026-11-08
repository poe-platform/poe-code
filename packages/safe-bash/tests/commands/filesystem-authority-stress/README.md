# Independent core copy/move authority checkpoint

August 27, 2026. This is a distinct review of Curie's committed consumers,
not the consumer author's own test count and not acceptance of every backend.
Ownership is this new test subtree and concrete fixes in
`src/commands/filesystem.ts` only. No production filesystem, wrapper, contract,
root export, old author test or private package was edited.

## Verdict and concrete fixes

The bounded independent cohort passes **92/92**, with zero skips or TODOs,
against the reviewed patch. The same complete cohort fails **7/92** against
the frozen pre-review source. Two consumer fixes account for those failures:

1. **`cp -P` could delete its own source symlink through alias mounts when
   final-entry identity was incomplete.** The previous branch unlinked the
   destination before reading the source link, without proving the directory
   entries distinct. The regression actually observes removal of the source's
   backing name; no malicious comparison callback is needed. Read the link
   before mutation, recheck entry identity before unlink, reject unknown
   final-entry identity with `ENOTSUP`, reject same entry with `EINVAL`, and
   remove only nonrecursively. A followed `compareEntry` answer is deliberately
   not used as final-symlink unlink authority. Known-distinct replacement and
   missing-target symlink creation still work. A readlink failure now also
   preserves the old destination.
2. **Cross-device `mv` reported successful status for same-file aliases.**
   Isolated GNU coreutils 9.7 returns status 1 and retains both hardlink names.
   A false fallback result without `-n` is an alias, so the command now reports
   `EINVAL`/status 1 rather than silently returning 0. `-n` remains a successful
   skip. No alias is copied or removed. This is an exit-status correction to
   the EXDEV consumer path, not a rewrite of backend native rename semantics.

### Original author-test coordination at `0bee8e7`

Two **unmodified at that checkpoint** author assertions expected status 0 for
alias moves:

- `tests/commands/entry-comparison.test.ts`: `cross-device move uses comparison
  same before copy/delete`.
- `tests/commands/move-cross-device.test.ts`: `cross-mount hardlink alias is a
  no-op, never copy followed by source removal`.

The original handoff requested owner adjudication using immutable GNU evidence,
retaining all no-copy/no-delete and source-byte assertions. That commit did not
edit the unowned tests. Its owner-integrated author/contracts result remains
**68/70**, not retrospectively 70/70. The original TAP and `evidence/review.json`
remain unchanged; the separately authorized correction is recorded next.

Poincare's mount fix `e8d308a11bf562efcfba1d8a861503883b4952a3` independently fixes
an older author fixture's observation problem. Before that FS fix, the frozen
author/contracts cohort was **69/70** before this review and **67/70** with its
consumer patch: an opaque proxy stripped `lstat` scope, but the old resolver
substituted scoped `stat` metadata. That historical extra failure remains in
the archived TAP. Do not attribute the owner's FS fix to this core patch.

### Authorized test-only closure, August 27, 2026

The user accepted the scoped consumer fix and explicitly authorized **exactly
two stale exit-status assertion corrections** in a separate test-only commit:

- `entry-comparison.test.ts`: the `same` comparison branch changes from 0 to 1;
  `unknown` remains 1 and `distinct` remains 0.
- `move-cross-device.test.ts`: the EXDEV hardlink-alias case changes from 0 to 1.

No other assertion, fixture, command behavior, contract or production file
changes in this closure. In particular, comparison counts, copy/removal counts,
source/destination bytes, successful distinct moves and `-n` skip behavior retain
their previous expectations. The profile is GNU 9.7 same-file rejection, not a
waiver of source-preservation requirements or general GNU/BSD parity.

The independent native case is `move same hardlink` in `native-gnu-9.7.json`:
GNU exits **1**, emits a same-file diagnostic, and preserves both names and their
identical bytes. The unchanged evidence SHA256 is
`51d72f9595f65b2e12a03069bd8ce20467ad697b7125375f19983c5d1a8a50bb`.
No native expectation was regenerated or edited to fit the implementation.
The original **85/92**, **68/70** and **11/11 killed mutants** remain historical
results; this closure does not overwrite their source hashes or TAP.

Validation freezes the then-current committed revision
`a3f26e6e2008677fc467dcc876c771fea5ab6284`, overlays only those two corrected test
files, and excludes all concurrent uncommitted worker changes. It is an explicit
composite snapshot, not a claim about later HEAD or the dirty working tree.
The review README is updated afterward and is not an executable test input.

| Closure check on frozen inputs | Result |
| --- | --- |
| Author/contracts, same five files as the prior 70-case cohort | **70/70**, zero skips/TODOs |
| Independent command authority corpus | **92/92**, zero skips/TODOs |
| Strict scoped TypeScript, both cohorts and owned tooling | pass |
| Project `npm run typecheck` | pass |
| Project `npm run build` | pass |

The existing installed tooling is Node v22.22.2 and TypeScript 5.9. The snapshot
contains 2,394 tracked input files; hashing before and after validation found no
input drift. Production `filesystem.ts` retains reviewed SHA256
`393ea36b78c2cc142633c0eb631bf4d316767b3992c0d5f0724135ca4f01403a`.
The corrected test SHA256 values are:

| Test | SHA256 |
| --- | --- |
| `tests/commands/entry-comparison.test.ts` | `85bc12350662758f78191f171b2cec922fdd642cfdbdee12fc2627ec3583cbb7` |
| `tests/commands/move-cross-device.test.ts` | `67f772e8dc1c6e95c524ea12d8b237be17b205aa0610412884c5d915562a1c49` |

Reproduce the snapshot with two `git archive --format=tar` invocations at that
revision: one selecting `src tests package.json package-lock.json tsconfig.json
tsconfig.build.json`, the other selecting `benchmarks`. Extract both into an
isolated directory, overlay the two corrected tests from this closure, and link
the already installed root `node_modules`. Run the five original author/contract
test paths listed in `review.ts`, the independent `*.test.ts` files, strict
scoped TypeScript, `npm run typecheck` and `npm run build` there.

| Frozen artifact | SHA256 |
| --- | --- |
| Source/tests/config archive | `9f3561f1c348f7893277d3543bac3a86ea9d67e1200d8462aa18b17b8b9d025d` |
| Same-revision benchmarks archive | `7578218f33f7f8a71bcec8918b2d24631027f0600a0c5f88f342e28b1a122ec9` |
| Complete input manifest after the two test overlays | `0d21a0b26edc416836dea01f3cc41287e600eba08517243913955f9372a75705` |

The snapshot, complete manifest, command arguments and raw logs are retained
locally under
`/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safe-core-closure-Rus4jL/`,
with final results in `complete-closure-report.json`. The first capture's
`closure-report.json` is also retained: its global TypeScript run failed because
the capture omitted committed benchmark modules imported by existing tests.
Adding those files **from the same frozen revision**, without changing any code,
assertion or expectation, resolved that capture defect. It is not a product
failure rebaseline. Both full test cohorts and both typechecks/build were rerun
on the complete snapshot; no remaining actual failure was suppressed.

## Frozen inputs and reproducibility

`review.ts` extracts an explicit `git archive` of
`745eaa62eebbe07b7fd30dccad4a73a1669f7124`, which includes consumer `f291156` and
contract `5076b32`. It includes production source, package metadata and the exact
old author/contracts test inputs. The tar SHA256 is
`48b836908d7d9b08381012a22919a9f8c413bc19dd69c134853cfb280285c0d2`.
The archive is retained in the local temporary path recorded in
`evidence/review.json`; the commit and archive command reproduce it even after
temporary cleanup. The immutable source and test hashes are recorded there.

The fixed-source run replaces **only** `src/commands/filesystem.ts` in that
archive, checking that the other consumers, contracts and wrapper comparator
remain hash-identical. The reviewed replacement SHA256 is
`393ea36b78c2cc142633c0eb631bf4d316767b3992c0d5f0724135ca4f01403a`.
An additional explicitly named owner-integration run overlays **only** the
committed `src/fs/mount/comparison.ts` from `e8d308a` onto that fixed snapshot.
It is a documented composite, not a claim to test a clean newer Git HEAD or the
current moving worktree. No uncommitted remote implementation is imported.

| Frozen cohort | Pass | Fail | Skip/TODO |
| --- | ---: | ---: | ---: |
| Independent, pre-review source | 85 | 7 | 0 |
| Independent, consumer patch only | 92 | 0 | 0 |
| Independent, patch plus committed owner comparator | 92 | 0 | 0 |
| Unmodified author/contracts, pre-review source | 69 | 1 | 0 |
| Unmodified author/contracts, consumer patch only | 67 | 3 | 0 |
| Unmodified author/contracts, patch plus owner comparator | 68 | 2 | 0 |

The 92 checks consist of 40 direct authority cases, 20 preservation/budget
cases, 20 mount/wrapper cases and 12 always-runnable GNU fixture comparisons.
All invoke the real command definitions from `filesystemCommands()`;
none substitutes the copy/move consumer with a helper implementation.

```sh
node --unhandled-rejections=strict --import tsx --test \
  tests/commands/filesystem-authority-stress/*.test.ts
node --import tsx tests/commands/filesystem-authority-stress/review.ts
```

The first command tests the working tree. The second reconstructs the frozen
baseline, applies the current owned consumer file, runs both cohorts, then
mutates only isolated temporary source copies. It prints a fresh report without
overwriting evidence; `--capture` explicitly replaces the evidence files.
Record any new consumer/test hashes rather than describing new results as the
original checkpoint. Test-only tooling uses Node builtins and existing `tsx`;
the production patch adds no dependency or host process.

Fresh working-tree strict scoped TypeScript, whole-project `npm run typecheck`
and `npm run build` passed at this checkpoint. Those are separately observed
moving-worktree results, not frozen-HEAD or full-suite certification.

## Authority and positive coverage

- Real hardlink aliases, followed source symlinks, complete opaque scope/dev/ino
  tuples, equal numeric coordinates in different actual memory stores, missing
  identity, unknown authority and missing optional methods.
- Different recognized client objects over one actual backend, alias mounts,
  distinct mounts and readonly source/destination wrappers. The test provider
  obtains answers from real backing metadata; it never uses a fresh per-client
  scope or an invented trusted-provider flag to claim distinctness.
- Successful cross-mount new-file and overwrite workflows, both shared and
  independent stores. Exact binary bytes and resulting source names are checked.
  A readonly source can be copied; moving it can publish a destination before
  source removal fails `EROFS`. The source remains. Destination rollback is not
  promised and is not invented as an acceptance requirement.
- Invalid literals and conflicting peers fail with `EIO`; real authority
  `ENOENT`, `EACCES`, `ENOTSUP` and `EIO` are retained. Parent abort preserves the
  original typed reason, prevents effects, and is not mistaken for missing data.
- Known tuples avoid optional comparison; each direct command observation
  queries its one context filesystem once. Mount resolution queries each
  recognized backing authority once per observation, without recursive peer
  negotiation. Successful overwrite may involve a second fresh backend-copy
  observation, so two backing clients can each be observed twice across the
  whole command. The suite records that distinction rather than claiming one
  metadata query for the entire multi-layer operation.
- Forced unlink rechecks stale observations, refuses unknown identity, protects
  a newly installed source hardlink, and recreates exclusively. Missing move
  targets and missing symlink targets reject raced creation without overwrite.
- Move publication failure, partial destination data, cancellation during copy,
  metadata and cleanup, later directory-entry copy failure, 128-depth and
  100,000-entry budgets preserve sources. No recursive source deletion occurs.

Ordinary `cp` can still delegate to a trusted backend's guarded native copy when
the optional comparison is absent or unknown. This test fixture uses the real
MemoryFileSystem's identity-aware `copyFile`; it does not authorize an unknown
truncating backend. Unknown cross-device move destinations are rejected before
calling even a hypothetical no-op copier. After actual distinctness has been
established, a trusted backend that lies about copy success is outside the
documented contract; these tests do not demand authentication of arbitrary
trusted plugins. Malformed/conflicting callback tests check the explicitly
required result validation, not a new malicious-provider sandbox promise.

## Native evidence and mutants

`native-gnu-9.7.json` contains captured exit codes, diagnostics and exact final
file bytes/symlink targets from installed, independently built GNU coreutils
9.7. Binary SHA256 values, version output, paths and capture time are recorded.
The commands run only fixed fixture arguments inside isolated temporary
directories, with `LC_ALL=C`, no external network and no product subprocess.
The stored vectors run without any native utility installed and are not skips.

```sh
CORE_GNU_BIN=/absolute/path/to/gnu-coreutils/bin \
  node --import tsx tests/commands/filesystem-authority-stress/capture-native.ts
```

Recapture writes stdout, not the frozen JSON. The native filesystem is not
forced across two host devices: successful native move final-state semantics
are compared to a deliberate virtual `EXDEV` fallback. This proves the tested
bytes, entries and statuses, not native cross-device crash durability or every
GNU option. Error text is recorded but parity requires error presence and
status, not matching platform-dependent wording.

**11/11 executable guard mutants were killed**, all running the same 92 tests
successfully to completion rather than failing import/type setup. Recorded
mutation hashes and failing test names cover:

- malformed answer acceptance and missing post-authority abort checking;
- unknown move no-op cleanup and unknown forced unlink;
- skipped force alias recheck and swallowed publication errors;
- source removal before publication and nonexclusive target creation;
- unknown final-symlink unlink, alias success status and missing depth budget.

## Handoff limits

Poincare retains all FS production ownership. This core verdict neither closes
nor reruns the historical **28/38 required remote positives**; the **10 blocked
remote workflows remain separately open** pending their owner's implementation
and verification. No live S3/WebDAV/real provider authority claim is made here.
Root contracts/exports and shared helpers remain unchanged. The two old alias
status assertions are resolved only by the explicitly authorized test-only
closure, with the original failures and GNU evidence retained.
No direct worker-message tool was available in this review slot; the progress
updates and this handoff expose the coordination request without claiming a
direct exchange occurred.

Point-in-time metadata is not a conditional delete, ABA protection, transaction,
destination rollback or protection against a lying trusted backend. This is a
bounded independent core checkpoint, not full command-option parity, all-backend
closure, a complete shell audit, or proof of superiority over another shell.
