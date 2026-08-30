# Independent metadata fixture qualification review

## Decision

Bounded acceptance of the **test-fixture qualification**, frozen at
`3a1025f53e502c3426ffee34eb8d8037b27c26f8`. No production chmod change was
approved, made, or simulated by mutation. The deliberate caller-member-group
metadata precondition is **not unchanged-all-input proof**. This review does not
certify a whole gate, Linux behavior, universal native parity, or superiority.

The independent reviewer owns only this new directory. Production, the author's
fixtures, historical captures, root configuration, and other workers' staging
remain untouched. The historical seal is
`9fa86b2fd23525bfa4ab944fef404654ce90c9d6`.

## Frozen evidence and counts

The final reproduction is `attempt-03`; `attempt-01` and `attempt-02` are retained,
not overwritten. Each attempt includes commands, timestamps, raw stdout/stderr,
native operation journals, source hashes, identity, cleanup and a SHA256 manifest.

| Final scope | Result | Meaning |
| --- | --- | --- |
| Seeded chmod cohort | 384/384 vectors; **1 TAP test** | Complete original seeded cohort, with approved fixture qualification |
| Directory setid controls | 48/48 vectors; **1 of 3 TAP tests** | All original mode/command controls, exact status/mode assertions retained |
| Entire chmod-controls file | 3/3 TAP | Also includes five native diagnostic/reference invocations and virtual traversal controls |
| Author archive/helper/profile regressions | 9/9 TAP | Includes two Darwin divergence characterizations, not two parity wins |
| Independent guards | 7/7 TAP | Archive, exact inverse diff, helper controls and static profile assertions |
| Ordinary aggregate above | **20/20 TAP**, no skips/TODOs | Scoped evidence only; vector counts are not TAP counts |
| Additional independent native replay | 4 member transitions, 17 nonmember characterizations, 1 denial | Separate script, not extra TAP tests |
| Isolated helper mutants | 4/4 killed | Missing chgrp, missing mode readback, missing ownership check, missing group readback |
| Structural mutations | 8/8 rejected | Lost vectors/assertions and equality/denial weakening; static guards, not native mutant runs |
| Scoped strict no-emit types | Pass | Eight explicit TS roots and their imported closure; not full-gate types |

`audit.mjs` additionally matches all 384 observed GNU argv/umasks and exact
initial-mode readbacks to the preserved vector list, and all 48 directory controls.
The source inverse diff restores both original complete test files exactly by
reversing only the declared helper import/setup changes. It does not merely count
command names or loosen expected results.

All **25 original raw artifacts** still exist and hash-match their preserved seal
copies, which also match the historical Git objects. The original **17 directory
failures** remain one `+2000` row and sixteen `ug+s` rows. Original requested06755
is not relabeled as original measured04755: that measurement belongs to later
replay. No historical denominator or failure is converted into a pass.

## Platform and actual effects

Measured host: Darwin25.4.0 arm64, Node **v22.22.2**, libuv **1.51.0**, uid/euid501,
gid/egid20, supplementary groups excluding0. GNU executable reports
`chmod (GNU coreutils) 9.7`; its SHA256 is
`3b7a9b5819dd93eff18b25dfbbac1c1d17e2ccd419368da90b366653b1b1cbd2`.
Node executable SHA256 is
`5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011`.
Full identities and paths are in `attempt-03/identity.json.data`.

The final independent member stress creates owned file/directory entries that
**naturally inherit gid0**, then renames them into the helper's authorized native
namespace without changing their metadata. The actual helper changes their group
from0 to caller-member20 before mode setup. Both file and directory support
genuine SGID creation and preservation, with exact06755 readback. Neither the
review nor the fixture ever requests chgrp0.

For every one of the separately replayed **17 nonmember directory inputs**:

- GNU returns1 with exact EPERM diagnostic and unchanged metadata including ctime.
- Node, RealFS and its chmod command succeed, clear SGID, and change ctime.
- MemoryFS succeeds with the requested virtual mode, not host credential policy.
- Sentinel bytes and directory namespace remain unchanged.

These are **divergence characterizations, not equality wins**. Independent actual
search-denial checks retain typed RealFS `FsError`/`EACCES` and virtual error path,
exact per-layer diagnostics, and unchanged file bytes/mode/ctime/identity. Different
diagnostic strings are checked separately, not declared equal or ignored.

The **older six-case strict GNU gap** remains separately historical and unresolved:
`u-s,g=s,o-t`, umask027, requested02707, file/directory initial04777/00777/01777;
GNU1/unchanged versus Node/RealFS0/0707 and Memory0/2707. Its ten original archived
artifacts at `../sgid-feasibility/` authenticate against277a635; those six cases
were **not freshly rerun** here and are not substituted for today's retained-SUID
directory cases. The unchanged normative classification is
`tests/commands/core-regression-stress/NORMATIVE_PROFILES.md`.

## Guard limits, discovery and safety

Independent helper probes use the exact frozen helper compiled into an isolated
VM with controlled filesystem/identity doubles. They cover authorization, caller
real/effective mismatch, unsafe names, symlinks, ownership, preflight ordering,
unavailable chgrp, dishonest readbacks, changed inode/group/root, invalid modes,
and SGID-cleared mode setup. These are deterministic helper controls, not a claim
that the host grants foreign ownership or that the helper is race-proof.

Only temporary **helper copies** are mutated; production is never mutated.
Lost-vector and profile/denial mutations exist only as in-memory test strings.
Raw expected failing TAP output and exact mutated hashes are retained separately
from baseline passes. Mutation processes execute four helper TAP tests each;
their failures are expected kills, not product failures or added passing cases.

The frozen candidate is extracted byte-for-byte from Git: 249 selected files,
including all production source, the selected fixtures and the historical seal.
Every copied file authenticates against the exact commit. The observer records
native setup/oracle calls, rejects unauthorized chown, and restores only owned,
non-symlink fixture modes for cleanup. It does not edit the frozen source. Its
post-chmod lstat and cleanup restoration are disclosed harness interventions;
this is not an uninstrumented timing/performance experiment.

All temporary native roots, copied source trees and helper mutants are removed.
The nonmember fixtures use isolated caller-owned `/tmp` roots with inherited
group0; ordinary cohort roots are inside this directory's temporary frozen copy.
Cleanup restores directories to0700 and files to0600 before removal, without
following symlinks. No userHOME, private checkout, ambient permissions, credentials,
dependencies, production files, root config or other workers' artifacts are changed.
Unrelated concurrent Git commits are recorded; they do not move the frozen target.

The repository's normal test glob discovers the author's pinned Darwin profile
tests. They explicitly **fail prerequisites**, rather than skip, on a mismatched
OS/architecture/Node/libuv/GNU binary or unavailable inherited-group profile.
Therefore their presence in default discovery is **not a portable OS pass claim**;
a Linux default run would encounter these prerequisites. Linux was not run.
This directory contributes only `review.test.ts` to persistent test discovery;
all captured source is `.data`, and temporary `.work` sources are removed. No
exclusion, type waiver, root script or discovery configuration is added.

## Preserved failed attempt and reproduction

`attempt-01`: native384, chmod controls, author regressions, types and all four
helper mutation kills succeeded. The reviewer archive test failed because it
assumed every historical observation had an `input`; the archive also contains
an input-less control record. Its raw TypeError and exact pre-fix reviewer sources
remain in `failed-attempt-source/`. The correction explicitly filters input-bearing
rows, then still requires exactly17 original failures. No author input/assertion
was changed. Live `/tmp` raw-source authentication is retained in the explicit
capture, not made a permanent ordinary-test prerequisite.

`attempt-02`: 20/20 ordinary TAP plus the independent17-row characterization passed.
`attempt-03`: repeats that complete bounded scope and adds actual inherited-gid0
member qualification stress plus recorded structural mutation hashes. Changed
attempt02 harness sources are preserved in `attempt-02-source/`.

The first commit succeeded with exactly113 new owned files. A subsequent packaging
assertion exposed doubled separators in top-level manifest paths, not a scope or
runtime failure. `packaging-audit.json.data` records the failure and normalized
path comparison; `packaging-initial-seal.json.data` preserves the exact initial
seal. The corrected final manifest uses only relative, normalized owned paths.

From the repository root, with the existing authenticated tools:

```sh
node tests/commands/metadata-stress/permission-profile-independent/audit.mjs
node --import tsx --test tests/commands/metadata-stress/permission-profile-independent/review.test.ts
node tests/commands/metadata-stress/permission-profile-independent/capture.mjs attempt-04
```

The capture refuses an existing destination. It performs scoped no-emit checking,
not a build, dependency installation or full gate. Recorded commands provide the
exact underlying invocations and environment deltas. Work timestamps are actual
execution timestamps; no72-hour duration or general project completion is claimed.
