# Independent initial tar acceptance corpus

## Current combined gate

The reviewed three-file test-integration patch is committed separately as
`7aaabcc`. Source and bounds workers have returned their owned changes for
collection; this gate does not edit those files or their evidence. The root
catalog is now 56 defaults, maintained by Curie. No tar workflow asserts a
literal catalog count or registers tar twice.

```sh
node tests/commands/archive-stress/final-evidence/run-final.mjs
```

This bounded runner seals **current working** source, including uncommitted
archive fixes and unrelated dirty runtime inputs, by matching before/after
hashes. It copies source, all actual archive test/helper inputs, package/config,
the verified installed dependencies and pinned GNU binary into regular files
in a retained private `/tmp/safe-bash-archive-final-*` snapshot. There are no
live Shell/FS/byte-command imports, symlink/hardlink aliases, or Git worktrees.
Source changes after sealing are reported separately, not represented as tested.
Output/evidence trees are excluded from recursive input copying. Other workers'
long-link and bounds evidence is only hashed, never modified.

The gate has a 900-second total budget, per-process time/output bounds and owned
process-group cleanup. It runs original author 128, default wiring 1, combined
independent 30 (19 original + 3 long-link + 8 bounds/hardlink), repeated GNU
author 5 as an overlapping subset, the actual full-source build configuration,
the existing four built-package checks, and scoped TypeScript covering archive
tests. Scoped test types are not a whole-repository typecheck. Counts/scenarios,
native observations and built checks remain separate denominators.

The new tests cover bounded configured limits, the unchanged 64-MiB member
default, small gzip amplification, specified partial effects, cooperative
extraction cancellation/resume, and actual hardlink inode/write aliasing rather
than content materialization. Their measured cases do not establish universal
memory bounds, forced cancellation of uncooperative hosts, remote-adapter
parity, or rollback. Requested private creation modes are advisory without
backend permission enforcement. Native BSD provenance-PAX rejection and its
separate global-mtime discrepancy must stay visible; no archive filtering or
expectation waiver is permitted. Final source/corpus commit authorization still
requires root review and the separate patch-review result.

The sections below preserve historical first-pass and integration-only
qualifications; their no-handoff/gap statements describe those earlier runs.

## Explicit handoff and integration follow-up

The user subsequently delivered the explicit author handoff (`be29e38`, author
evidence `0eaffb77`) and assigned archive production, independent tests, and
intentional author-fixture integration fixes to this worker. Archimedes stops
archive edits. The earlier no-handoff/ownership statements below describe the
original initial pass, not the current authorization. The original raw 15/18
and 17/19 outcomes remain provisional historical observations.

Root integration `4a737f9` installs tar in the 53-command aggregate. The bounded
follow-up changes only test integration: author fixtures install the aggregate
once and pass limits through its `archive` options; the built fixture also uses
default aggregate tar. It introduces no blanket replacement. Existing direct
collision checks remain, and a new narrow author-scope integration test checks
default execution, asynchronous duplicate-plugin rejection without replacing
the registered command, and configured member-limit forwarding.

```sh
node tests/commands/archive-stress/run-integration-review.mjs
```

This separate runner freezes a committed complete source/package/author-test
snapshot descended from `4a737f9`, overlays only explicit owned fixtures, copies
the independent harness, and makes regular byte-hashed copies of the existing
installed dependencies and pinned GNU 1.35 executable. It does not include other
workers' dirty source changes or use live aliases. It retains baseline and
candidate tests/fixtures, dependency/source hashes, native observations, and
moving Git state. It runs original author 128, separately repeats their five
native cases, runs the one new wiring test and independent 19, plus scoped
TypeScript and built-fixture syntax checks. The five native reruns are a subset,
not five additional unique acceptance cases. It does not rebuild or claim four
fresh built-package workflow checks. Native skips cannot make this review gate
green; nonzero statuses and the two BSD counterexamples remain failures.

The first integration runner attempt (`.runs/integration-jKMMVB`) restored
128/128 author and 5/5 native passes, with independent 17/19 unchanged. Its new
wiring test initially assumed `Shell.use()` throws synchronously; the actual
API queues setup until `exec()`. The assertion now checks that asynchronous
rejection and registry entry preservation instead. This harness API correction
does not weaken the expected duplicate-registration rejection. Initial evidence
is retained. With GNU correctly present, that run's own baseline was 17/128
pass and 111 duplicate-registration failures, including the five native tests.
Do not confuse this with Curie's separately attributed historical frozen
365 pass / 111 fail, classified there as 106 duplicate-registration fixture
failures plus five unavailable GNU oracles. No historical finding is erased.

The acceptance-final and hardlink readonly reviews were consumed. Their bounds,
post-publication cancellation/partial effects, and documentation follow-ups are
pending a separate source-fix review, not implemented or counted in this test-
integration patch. The six hardlink vectors remain the other reviewer's result:
real inode aliasing is not content copying; no rollback or universal permission
enforcement is claimed. The 64-MiB default member limit is unchanged.

## Original initial-pass record

This is a bounded **provisional** corpus, not a production handoff or final
acceptance. Archimedes retains archive implementation ownership. Only this new
directory belongs to this assignment. Nothing here changes the registry, jq,
filesystem implementations, author tests, root exports, or dependencies.

## Run

From the repository root, with the already installed locked development tools:

```sh
node tests/commands/archive-stress/run-provisional.mjs
```

The runner copies only archive source and shared contracts into regular files
under ignored `.runs/provisional-*/frozen/`. Copies are checked against original
SHA-256 hashes, and are neither symlinks nor hardlinks. No worktree, branch,
installation, network request, or commit is involved. It runs exactly these
two test files, then the new scoped TypeScript configuration. Test logs, native
observations and raw archive artifacts, before/after manifests, Git HEAD and
dirty state, Node version, and installed-versus-locked tool versions remain in
that run directory. A failing test makes the runner fail; nothing reclassifies
a failure as a skip or successful compatibility result.

MemoryFS, Shell, and byte-command runtime dependencies remain live, not frozen
or source-inspected by this assignment. Scoped TypeScript checking necessarily
follows transitive imports; it is neither an isolated archive-only typecheck nor
whole-repository validation. Lock integrity strings are recorded, not presented
as a fresh integrity attestation of every installed package file. These limits,
the changing repository, and the absence of an explicit author handoff prevent
any final acceptance claim even when source hashes are stable during a run.

Direct moving-worktree alternatives (also provisional):

```sh
node --unhandled-rejections=strict --import tsx --test --test-concurrency=1 tests/commands/archive-stress/acceptance.test.ts tests/commands/archive-stress/native.test.ts
node node_modules/typescript/bin/tsc -p tests/commands/archive-stress/tsconfig.json
```

## Scope and independent expectations

The 15 deterministic cases run without native tar. The four optional cases
separately test GNU/BSD in each direction, with plain and gzip phases inside
each case. Both phases are attempted even when one fails. Missing native tools
produce explicit skips, not invented oracle passes. GNU candidates include the
existing author-provisioned executable, but no author observations or expected
results are imported: every native command is executed anew with version and
binary SHA-256 recorded. BSD uses a local bsdtar executable. Native commands
have an eight-second timeout, SIGKILL on timeout, four-MiB captured-output cap,
and a minimal fixed environment. Host extraction uses only test-generated safe
archives in new controlled `.native-*` directories, removed in `finally`.
Malicious/truncated archives are sent exclusively to the virtual filesystem.

All payload expectations come from explicit xorshift32 seeds and input lengths;
PAX/USTAR fixtures are constructed locally without calling product format code
or author helpers. Native tar independently validates the fixture with global
PAX metadata, repeated local UTF-8 path keys and a following ordinary member.
Native crossreads assert independently specified filenames, bytes, and actual
symlink types/targets, not merely successful exit codes or listing substrings.

| Cases | Additional discriminator beyond author coverage |
| --- | --- |
| A01 | Source mutation after named creation, selected extraction truncation, exact sibling/source effects. |
| A02 | Independent raw USTAR prefix/checksum/padding decoder; no virtual-reader oracle. |
| A03–A05 | Local state consumed across exclusion, global replacement, repeated keys, PAX selection before stripping. |
| A06–A08, A15 | Effective PAX paths/linkpaths, hidden traversal, forward long links, existing symlink ancestors. |
| A09–A10 | Corrupt/truncated extension records cannot replace preexisting payloads or leak raw placeholders. |
| A11 | Concatenated gzip streams split inside PAX framing, not one ordinary gzip member. |
| A12 | Multi-file gzip→gunzip→gzip→tar pipeline with 31-byte pipe watermark. |
| A13 | Backpressured gzip output resumes without overlapping writes or losing bytes. |
| A14 | Both composed gzip commands settle on a shared caller abort with blocked listing output. |
| N-GNU/BSD-in/out | Independently generated native crossreads, long-link type preservation, both compression modes. |

Some requested categories necessarily overlap the author's broad suite. This
corpus does not duplicate its options matrix, malformed-type catalogue, backend
capability testing, or author native expectations. It does not expand supported
grammar, establish full tar/Bash parity, or resolve the `head -n 0` shared
lifecycle limitation. Cancellation does not forcibly interrupt uncooperative
host work; the blocked test sink is explicitly released in cleanup.

## Initial observations and review questions

The first run (`.runs/provisional-Tsymmb`) recorded **15/18 pass, 3 fail,
0 skip**, plus a successful scoped typecheck. Preserve that historical result.

- A04 accidentally combined duplicate-key acceptance with `vendor.harmless`,
  contradicting the already documented rejection of unknown vendor PAX keys.
  This was a harness scope error, not a production defect. Its ancillary field
  is now the explicitly recognized `comment`; duplicate-path expectations are
  unchanged. The original failed log and hashes remain. A10 also now places a
  truncation boundary inside the UTF-8 scalar as its title promises. A15 adds
  an effective-PAX-path symlink-ancestor check.
- BSD→virtual failed on a locally generated
  `LIBARCHIVE.xattr.com.apple.provenance` PAX key. This is an actual measured
  interoperability gap under the documented strict unknown-key policy, not
  permission to invent xattr support or to filter native output into a pass.
- Virtual→BSD listed successfully but extracted the long-target symlink as a
  regular empty file. GNU preserved the link. Keep this file-effect failure
  visible; successful listing does not imply faithful extraction.
- A second run (`.runs/provisional-kpdkbf`) recorded **17/19 pass, 2 fail,
  0 skip**, with scoped types passing. An added independent native metadata
  assertion exposed a BSD difference: the ordinary member after a local PAX
  override used its raw header mtime (1700123456000 ms), not the global PAX
  mtime (1700123400000 ms). GNU used the global value. This is a native-oracle
  disagreement, not a demonstrated virtual metadata defect. The check remains
  visible and later native crossread phases now continue after this failure
  so it cannot mask the original BSD input failure. Both BSD output compression
  modes failed the long-target symlink file-type assertion.

Questions for Archimedes/root review (not delivered through an unavailable
coordination channel): confirm how the documented unknown-vendor policy should
be presented for BSD-created archives; review portable long-link header
encoding; identify the actual author handoff/frozen source revision before
final acceptance; confirm eventual root export integration separately. No
source fix, policy exemption, or expectation weakening is authorized here.

The readonly review at `/tmp/safe-bash-archive-acceptance-review-detail.txt` was
consumed (SHA-256
`ad88fd7e4208d64ac916aba48ea01e449a29db58e0ddbd4e842975bc50c86b04`). Its
source hashes and native identities match this corpus's captures. Its proposed
18 cases are a design proposal, not 18 executed acceptance tests. A03 was
refined to test filtered extension-state consumption after the review identified
existing author coverage of ordinary global/local precedence. No existing
failure expectation was weakened by this disjointness refinement. The review's
native-only observations are separate from this corpus's product runs; its
coordination request remains undelivered. This assignment does not adopt its
cross-backend proposal, new ownership, or additional permission to inspect FS
source. Remaining gaps include transformed hardlink selection, GNU L/K state
across exclusions, gzip extractor partial-publication/late-CRC effects, and
broader backend interoperability.

The third preserved run (`.runs/provisional-MSBl6u`) was **17/19 pass, 2 fail,
0 skip**, with scoped types passing, and attempted both BSD input compression
modes despite the independent metadata discrepancy. Subsequent scoped logs
record the final filtered-state refinement and explicit virtual list/extract
observations separately. No failure is waived or converted to a native skip.

Root must review corpus and oracle evidence before any eventual atomic
`git commit --only` with explicit owned file paths. No commit is made here.
