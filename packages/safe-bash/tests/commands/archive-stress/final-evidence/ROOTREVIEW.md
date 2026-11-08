# Final bounded archive gate — root review

## Disposition

**Combined gate remains failing: 158/159 unique test cases pass, one fails.**
No skip, cancellation, or TODO occurred. Build and four built-package checks
pass. This is sealed **current working input** validation, including uncommitted
source; it is not clean committed-HEAD validation or complete tar acceptance.

Only the separately approved fixture integration was committed:
`7aaabcc3895fbfe94591c5848f49ffb536e1f84b` —
`test(archive): use aggregate tar in integration fixtures`.
The exact reviewer-approved hashes matched before explicit-path staging and
`git commit --only`. Its three paths are author `helpers.ts`,
`built-package.mjs`, and `aggregate-integration.test.ts`. No source or independent
corpus entered that commit. `integration-commit.json` records the approval hash,
commit paths, before/after state, and unchanged unrelated cached diff.

The separate patch review **accepts** the one-line writer fix, README
qualifications, and eight bounds/hardlink cases without requesting source or
assertion changes. It identifies a commit-order prerequisite: the bounds tests
import currently untracked `../helpers.ts` and `../fixtures.ts`. Root must
authorize those core helpers first or in an explicit coherent combined batch.
No additional source/corpus commits were made by this gate.

## Counts — do not sum subsets or scenarios

| Cohort | Pass | Fail | Total | Evidence |
| --- | ---: | ---: | ---: | --- |
| Original six author files | 128 | 0 | 128 | `gate-3ecvdu/author-128.tap` |
| New default-tar wiring case | 1 | 0 | 1 | `gate-3ecvdu/default-wiring-1.tap` |
| Independent original core | 18 | 1 | 19 | Subgroup of independent TAP |
| Long-link regression | 3 | 0 | 3 | Subgroup of independent TAP |
| Bounds/hardlink regression | 8 | 0 | 8 | Subgroup of independent TAP |
| Combined independent | 29 | 1 | 30 | `gate-3ecvdu/independent-30.tap` |
| Repeated GNU author subset | 5 | 0 | 5 | `gate-3ecvdu/native-author-subset-5.tap` |

Unique candidate total is **128 + 1 + 30 = 159**, not 164. The five GNU author
cases overlap the 128. The bounds cohort emits 22 diagnostic scenario records
inside eight tests; the long-link native cases contain four consumer/format
combinations inside two of its three tests. Neither increases the denominator.

`source-build.log`: actual full-source `tsconfig.build.json` build, exit 0.
`built-package.log`: existing four API/dependency/gzip/listing workflow checks,
4/4, executed against that newly emitted `dist/`, not syntax-only validation.
`scoped-types.log`: all archive/owned-stress tests and transitive imports, exit
0; **not a whole-repository typecheck**. No full package test, comparator,
separate FS/jq/table-text suite, or catalog gate was run. Curie maintains the
user-authoritative 56 default names; no literal catalog-size assertion was added.

## Remaining failure and successful source repair

The only failing test is
`N-BSD-in native PAX plain/gzip archives and independent extension fixture extract virtually`.
Its two distinct observations remain intact:

- Unfiltered BSD-produced plain **and** gzip archives cause virtual list and
  extraction exit 2: `unsupported PAX keyword: LIBARCHIVE.xattr.com.apple.provenance`.
  Output namespaces are empty. This is a measured interoperability loss under
  the existing strict unknown-vendor policy, not a silently waived capability.
- The native-only fixture's following member receives raw-header mtime
  `1700123456000` ms in BSD rather than global-PAX `1700123400000` ms in GNU.
  This is not a demonstrated virtual metadata defect. The native mismatch does
  not suppress either subsequent compression-mode crossread.

Virtual-to-BSD long-target symlinks now remain actual symlinks with the exact
126-byte target in both compression modes. GNU both directions/plain/gzip also
pass. The source worker's separately reviewed causal baseline was 2/4 successful
native consumer/format semantics; its fixed result was 4/4. Preserve that
baseline, its two BSD failures, and its eight control observations. This gate
reruns the fixed cases; it does not add those observations as unique tests.
No native xattr filter, expectation change, scope waiver, or source edit was
made by this collection/gate step.

## Sealed inputs and reproduction

Run from the repository:

```sh
node tests/commands/archive-stress/final-evidence/run-final.mjs
```

Final raw evidence is `gate-3ecvdu/`. The complete regular-file snapshot,
including dependencies, GNU executable, source, tests, configuration and newly
built output, is retained **outside the project**:

`/tmp/safe-bash-archive-final-Eb1o8s/snapshot-1`

This is not `git archive HEAD`: current `src/**`, including dirty/untracked
runtime inputs and the returned format/README patch, was hashed, copied, then
rehashed at the live and frozen boundaries. One sealing attempt succeeded.
All 514 input files are regular files with `nlink=1`, different backing inodes
from their originals, and no live source/module aliases. The closure contains
156 source files, 318 installed dependency files, 36 test/harness/oracle files,
and four package/config files. Output/evidence trees are excluded from recursive
copying. Returned long-link/bounds evidence was hashed before/after unchanged.

The sealed input manifest, frozen pre/post manifests and moving post-run input
manifest all have SHA256:
`6910c4b361aaf80bdcbb3913019ed2ccf59fbfe7160954997ffbea07db73d32d`.

| Subset | Manifest SHA256 |
| --- | --- |
| Entire source | `26a964dbbccc9f7ff31e8557bfa5228ffc341297700ae54d7544bcde8bd80ca9` |
| Archive source/docs | `144bbae1d6c02e7fe34c37e9414faaf52bf26eeddb0520d6b4c2fff5f304a0f7` |
| Installed dependencies | `3349458b39516888c0586101279f0511b3058167c03379a1f0e99f28eb1dc20a` |
| Test/harness/oracle inputs | `ddcc4b856c7dff20c74c074e91391371ee5eb3e08572262bd9eb291f5bfb6cc7` |
| Protected worker evidence | `893435c98d85065a0432cfdf932b848b1c29b81a76caf82cea8f8d4341cf1ad9` |

These are SHA256s of ordered JSON file records including relative path, byte
length, mode and content SHA256, not Git tree IDs or old-run manifest formats.
Every individual hash is retained in `gate-3ecvdu/evidence.json`.

Archive `format.ts`: `30ba491fca428e91e11bc26802f6e69d05f94fdd30ab1c40f5812a4e92827719`.
Archive `README.md`: `a2dad5781d249f9a206739cb7ab36cf77c839abe8ea1222e16abdea953896069`.
The original writer hash was
`d2a1106ab7e484aaa2b5ad57c7b17fa7d93ae51cd1f4e54b7ddc34b1d05a14d0`.
The source fix writes only the nonempty raw `PaxLink` fallback while retaining
the authoritative full PAX target. Other archive executable files retain the
handed-off source bytes. README changes qualify permissions and observed identity.

Run: `2026-08-27T01:14:46.661Z` to `2026-08-27T01:14:57.174Z`, 10.513 seconds,
within the 900-second gate budget. Seal: `01:14:47.338Z`. These are August 26,
20:14 local America/Chicago. Moving HEAD before/after:
`a3f26e6e2008677fc467dcc876c771fea5ab6284`, descendant of `33347b7`.
The tree was dirty: archive format/README plus unowned WebDAV source/docs and
test changes were visible. All runtime source changes, including unowned ones,
were captured rather than substituted with committed-only bytes. No unrelated
source or test was edited. Git state is recorded, not certified clean.

## Commands, executables and cleanup

Exact argv, cwd, status, raw-output hashes, counts and process-group cleanup are
in each `evidence.json` command record. Tests use strict unhandled-rejection
handling, `--import tsx`, `--test-timeout=20000`, `--test-concurrency=1`, and
explicit file paths. `ARCHIVE_LONG_LINK_NATIVE=1` ensures all three long-link
tests exist. `ARCHIVE_ACCEPTANCE_SOURCE` points into the frozen source;
native observation output points to this new gate directory. Loader override
variables are cleared; none were set at the final run. tsx disk caching is off.

Build: `node node_modules/typescript/bin/tsc -p tsconfig.build.json`.
Built checks: `node tests/commands/archive/built-package.mjs`.
Scoped types: `node node_modules/typescript/bin/tsc -p tests/commands/archive-stress/final-evidence/tsconfig.scope.json`.
Replay these recorded commands from the retained snapshot; rerunning the
repository's runner instead seals a **new current** tree, not an old replay.

Node v22.22.2/darwin arm64; existing copied versions match the lock: tsx 4.23.12,
TypeScript 5.9.3, @types/node 22.20.1, esbuild/platform esbuild 0.28.2.
Full installed bytes are hashed, without claiming a new registry-integrity
attestation. Node builtins, OS/dylibs and native system helpers remain external;
this is not a hermetic OS sandbox.

GNU tar 1.35 is copied to the author's hardcoded relative location
`tests/commands/archive/.oracle/gnu-tar/1.35/bin/gtar`, SHA256
`49a0bd353ad67347674d00a7b3eeb171da58728f7e4577c9b320d8ab1e7bba66`.
BSD 3.5.3/libarchive 3.7.4 SHA256:
`bdccb76a715fbebc4915a1a1b1de0e7050ad842ebb730c47935b3a22c13e3af9`.
Apple gzip/gunzip 479 identities and Node executable hash are also recorded.
No prepare-oracle download, installation, network or private repository access.

Per-process ceilings are 120 seconds for scoped tests, 180 for build, 90 for
types, 60 for built checks, five for version probes, and 16 MiB captured output.
All fit inside the 900-second watchdog. Each child runs in its own process
group. Groups were absent after completion; no timeout, output-cap kill, or
leftover native fixture directory occurred. Native host extraction stayed in
controlled private snapshot fixtures. Malicious/path cases remained virtual.
Snapshots and evidence are intentionally retained; transient native fixtures
and child processes are not.

## Measured safety scope and limitations

- Exact/one-over entry/PAX/expanded-archive controls pass at small configured
  bounds. Default member limit remains 67,108,864 bytes. A 67,108,865-byte
  header is rejected after one pull, before publication; the exact-default
  header reaches the intentional body-read error. This is not a successful
  full 64-MiB extraction or a 64-MiB allocation test.
- A 102-byte gzip expands to 9,728 bytes. With a 2,048-byte archive limit,
  failure retains exactly 1,536 payload bytes; with 9,728 it accepts 8,192.
  Body/padding/late-CRC controls preserve measured earlier/current effects.
  There is no whole-archive rollback or transaction promise.
- The cooperative blocked gzip writer's predeclared maximum is 16,384 source
  bytes; both resume/abort observed 1,024 bytes/two pulls while blocked. Resume
  completes losslessly. Abort retains exactly seven bytes, preserves reason
  identity, and observes writer/source/iterator closure with no later effects.
  This is not universal forced cancellation, a whole-process RSS bound, or an
  approved `head -n 0` lifecycle redesign.
- Hardlinks are same-scope/device/inode aliases with nlink=3 and shared
  write/append effects, never content materialization. Missing/false link
  support rejects without a copy fallback; virtual escape controls preserve
  outside namespace/bytes. This is not remote-provider hardlink parity.
- Requested 0700/0600 modes require backend permission support to enforce
  privacy. Identity-unknown targets cannot prove absence of same-type races;
  no lease/ABA or pathname-race guarantee is added.

## History and commit-order review

Original raw 15/18 and 17/19 outcomes remain preserved, including the documented
A04 ancillary vendor-key fixture correction and filtered-PAX disjointness
refinement. Curie's **attributed** 365 pass/111 fail remains separately classified
as 106 duplicate-registration fixture failures plus five unavailable GNU
oracles. This worker's own correctly provisioned unpatched baseline was
17/128, with 111 duplicate-registration errors including all five native cases.
Fixture-only corrected author 128/128 and independent 17/19 remain distinct
from this source-fixed combined gate. No historical record is erased.

`gate-XsPINZ` is the first combined run: identical cohort outcomes, successful
build/built/types, with retained snapshot `/tmp/safe-bash-archive-final-5OQwpu/snapshot-1`.
The final run hardens loader-environment clearing and captures a newer current
tree; no test or source assertion changed. Do not sum these reruns as coverage.

Patch review SHA256:
`c3c4c114661013df86a5a8d11affe463f937a6a0a471c23c3678129beb2a5a84`.
It accepts source/bounds evidence but requires these untracked helpers before
a standalone bounds commit:

- `tests/commands/archive-stress/helpers.ts`, SHA256
  `de089f30095b93d748cb0eb56dbc3c36f69daccc5c7448ca670286aac567a1ff`.
- `tests/commands/archive-stress/fixtures.ts`, SHA256
  `c7b06c358d9fa9420c07fd10afde592781c324a7242f218340805f941bf32b85`.

The long-link source/regression/evidence batch is separately self-contained
(25 owned files listed in its unchanged worker handoff). Bounds tests/evidence
need the helper prerequisite or explicitly coordinated inclusion. Core failing
native observations must not be committed as a falsely green corpus. Root must
authorize coherent **explicit file-path** batches; no blanket directory staging.
Returned worker manifests/evidence are unchanged. This report stops before
remaining commits. No full tar/Bash parity, superiority, 72-hour completion,
or completion of the broader product is established.

## Post-gate concurrent commit observation

At `2026-08-27T01:20:38Z`, after the recorded gate and while this report was
being completed, moving HEAD was `a7cd4bbd03b42350262dee4b8cd6f1755ba38877`.
Scoped history now contains concurrent source commit
`f845dd0d728b74576c3e830eabff28a37f673893`
(`fix(archive): preserve long PAX links for BSD readers`). This gate did not
issue that commit. The live archive format/README hashes still match the sealed
values above; their scoped worktree status is clean. This observation updates
commit ordering only: it does not rewrite the dirty state at sealing or claim
that the later entire HEAD was tested. The shared-helper prerequisite for the
still-uncommitted bounds corpus remains. No concurrent work was undone.
