# Independent frozen padding verification

**Scoped padding GO; public integration HOLD.** No column defect requiring a fix
was reproduced, and this verifier changes no product source. The unchanged old
holdout and packed strong unregistered-return assertions still fail literally.
Those raw failures are preserved, not relabeled as passes or described as a
registered-cleanup breach contrary to Root's current policy.

## Source and isolation

| Input | Identity |
| --- | --- |
| Independent preparation | `71a623ce5f4b37018a8ef61ebad20a4aa34aec07` |
| Author source/test commit | `a809635432f18a235b8fb622a05367bedc54b315` |
| Author evidence seal | `60863db0` |
| Six-file source digest | `e4f9a8d1690600807d496ae8bc42409cc98344ee7bba10ea702a136d52cd370e` |
| Column source tree | `8b32998383d1372a8624ac41d2e747551e5b6d4c` |
| Whole actual Git archive SHA256 | `6c707cc82366675b7e39282847a3b5365a916ad9d8c48694861e7f9f99e48bad` |
| Packed tgz SHA256 | `529496a1e75423c0de50415afca2098b421c11617447ba155799e2afdbd4a684` |
| Moved package inventory SHA256 | `81431ee331fb93df43bf975eba01166f8304d4cbccfe5b32f43490ebd3534c54` |

The evidence commit is the enclosing explicit-owned-files commit, reported after
commit; there is no verifier source/fix commit. The six-path SHA256 map and its
ordered-map digest appear in the captured author seal and independent audits.

All **26,647 original Git blobs** were authenticated in an actual whole-commit
archive before execution and again afterward. It is a regular isolated directory,
not a worktree, cherry-pick, source overlay or live-module alias. Twelve tracked
test-fixture symlinks are preserved and authenticated as link text without being
followed; product source is regular files. Seven individually verified installed
development packages are the only links to the live repository.

`captures/final-integrity.json` records source/archive/tool/dependency identities,
all 736 generated build entries, process retirement and packed identity. Before
runtime and after runtime, the same **27,390 file/link entries** have inventory
digest `dbd982bd897077fa53e20d9994184a8bb6801323fd903cd887948475ad851ba6`.
This recursively detects added/removed/changed files and symlinks; **empty
directories are not inventoried**. Original membership comes from the immutable
Git commit; generated membership and dev links are recorded explicitly. Full raw
inventory files remain in the isolated scratch, with SHA256 and paths in the
committed audit summaries; they are not duplicated three times in Git.

Live HEAD at initial inspection was `c53bc3be9c71927876afa779b92e3f7426c76a5e`,
with an empty index and unrelated untracked native/review artifacts listed in
`SUMMARY.json`. They neither entered nor vetoed the selected archive. All nine
sealed prep files and 52 earlier stress files remain byte-identical. The old
`38cb670a` source and 37/40 result remain historical, not retrospectively buggy.
Alias tree `5e8ac069bfa6ead7a337130457cd6519f2066e2c` matches `04644bc2`; no alias,
shared-input, lifecycle, FS, root/default/export/config or package source is edited.

## Exact cohorts — overlapping, never an additive union

| Cohort | Actual outcome |
| --- | --- |
| Sealed literal controls | **17/17 pass** |
| Sealed safety schedules | **16/16 groups; 38/38 nested checks pass** |
| Additional admitted/invalid maximum-width controls | **2/2 pass** |
| Author suite | **148/148 pass**, no skipped/cancelled/TODO |
| Earlier independent context/late-abort regressions | **6/6 pass** |
| Unchanged old 40 holdouts | **39 pass / 1 fail** |
| Old original nested membership | **83 pass / 1 fail = 84** |
| Old supplemental membership | **4/4 pass**; combined old harness **87/88** |
| Moved packed consumer | **7 pass / 1 retained failure = 8** |

The author denominator is 113 existing prospective tests (two explicitly evolved
assertion selections) plus 35 new author tests, not 148 untouched historical
assertions. This verifier changes none of them. Exact file arguments and strict
compiler roots are retained in `captures/run1/cohort-inputs.json` and raw command
records. Independent safety nested counts E01–E16 are respectively
**2,1,1,1,1,2,2,2,5,1,3,2,8,4,1,2**. Zero unhandled rejections were observed by
the new cohort handlers and the unchanged old harness.

N01/N03 use their original literal argv/input/golden bytes. N01 now retains the
three spaces after `9` and two after `22`; N03 retains two spaces after first-row
`c`, without changing its explicit-empty fourth field on the second row. These
are the deliberate authorized profile evolution, not edited holdout expectations.

## Native profiles

No new native execution/build/download/install occurs in this runtime phase. The
sealed **34 new native records plus ten identity probes** remain unchanged;
their bytes/status/stderr are compared separately, not normalized. Binary hashes
were checked against the existing pinned files:

- util-linux 2.41.2 / Darwin libSystem, `en_US.UTF-8`:
  `a599976edf85eaa3222ac745309596023b5e63283a8b8ee3c3834d741214dd88`.
- Darwin BSD `/usr/bin/column`:
  `c6d7b469d8e8437c7185bedd356626ca69867c9c6b002cbb0020d995a6e4cc5f`.

For the new 17 controls, util-linux is **17 exact / 0 different**; BSD is
**4 exact / 13 different**. The BSD differences partition into four unsupported
`-o` cases, one final-partial-line error and eight other dialect differences.
For the unchanged original 44 native variants per profile, this candidate has
util-linux **20 exact / 24 different** and BSD **11 exact / 33 different** across
all stdout/stderr/status axes together. These are separate denominators, not full
native compatibility, GNU/Linux, locale or universal Unicode claims.

## Complexity, allocation admission and negative controls

Frozen `table.ts` creates two O(columns) suffix/link arrays after charging column
metadata work. Suffix sizes saturate at the configured output cap plus one. A
ragged tail computes its size and admits output/work before allocating its bounded
buffer. Zero-byte tails return in O(1); positive-output links skip zero-width,
empty-separator columns. The row loop visits actual parsed cells, never a padded
rectangle. Overall rendering is O(columns + actual cells + rows + admitted tail
output), in addition to bounded input/display processing. Actual-cell limits do
not charge phantom missing fields. There is no `maxColumns` API option.

The sparse fixture has 20,000 rows, 1,024 maximum fields and 21,023 actual cells,
versus 20,480,000 hypothetical rectangular slots. With empty separators it
successfully emits the exact 40,000-byte stream using **126,152 recorded work
units**. The nonempty-separator counterpart refuses at the 4,096-byte output cap
with that exact emitted prefix, without rectangular allocation. A separately
instrumented frozen-build reference observes **22,045 width reads**; it is
explicitly a sidecar, not substituted candidate acceptance. No giant expected
matrix/string or native huge-input bomb is used.

The preallocation guard rejects a mutated attempt to allocate 4,097 bytes with
only 1,023 output bytes remaining. The genuine candidate never makes that
allocation. Multibyte separators and combining scalars are charged by UTF-8 bytes,
not display width. The 65,543-byte padding/backpressure control produces the exact
stream hash, no concurrent writes, and a maximum observed chunk of 8,192 bytes.
Cancellation, late rejection, partial sink effects, reused byte buffers, invalid
UTF-8/NUL/control input, final partial records, operands and cumulative budgets
are captured in the 38 safety checks and unchanged older cohorts.

Five deliberately faulty semantic mutations are **all rejected**: stripped
padding; bypassed output admission; rectangular row expansion; uncharged
zero-output width scanning; bypassed work admission. Their raw nested outcomes
are **16 fail / 6 pass = 22**, not extra candidate successes. Rectangular expansion
trips at 100,352 observed slots; the unchecked scan trips at 1,000,001 width reads.
Instrumented/corrupted copies have separate paths, exact insertion text and module
hashes in `captures/negative-copy-provenance.json`; no candidate file is replaced.

Three runner negatives also fail as intended: hung child, output flood and a
surviving worker group. Their forced cleanup is never a product PASS. Real candidate
large-case children have a five-second deadline, 128 MiB V8 old-space setting and
64 KiB outer stream caps; all close normally. The V8 setting is not an RSS limit.
This is bounded structural/operation evidence, not comparative timing or memory
performance certification. The maximum configured fill width is exercised with
small input; it is not a claim of rendering a 67-million-column physical cell.

## Build and physically moved offline package

Production build, independent strict NodeNext source/test checking, and moved
standalone consumer strict checking pass. The independent compiler invocations
enable library checking (no `skipLibCheck`). New MJS helpers receive syntax checks,
not a claim of TypeScript `checkJs` coverage. Node is 22.22.2, TypeScript 5.9.3,
npm 10.9.7; all seven locked development-package file inventories match before and
after. Installed lock integrity declarations are checked, not presented as fresh
tarball/signature authentication. No runtime dependency is added or installed.

The actual built candidate is packed with `npm pack --offline --ignore-scripts`.
The extracted package is physically renamed into `moved/node_modules/virtual-bash`;
the original extraction is absent. All **738 packed files** match before/after,
including newly added-file detection (empty directories not inventoried). Runtime
uses a network-denying sandbox that also denies live workspace, candidate,
staging and mutant-tree reads, with `NODE_PATH`/`NODE_OPTIONS` cleared.

Root Shell resolves from the moved package's public root; column resolves only
through its packed internal `dist/commands/column/index.js` file URL. Compiler
resolution traces bind the corresponding declarations inside that moved package.
No public column subpath assertion or integration claim is made. The standalone
plugin requires no agent aggregate; collision/replace, ordinary pipeline/VFS
bytes, both evolved ragged pipelines, owned VFS cancellation/disposal, inherited
context and late caller-abort identity pass. Exact entry hashes and byte effects
are retained in `captures/packed-runtime.json`.

## Shared policy, retained failures and stop

The unchanged S38 assertion remains exit1 with `execSettledBeforeReturnRelease:
true`, `disposeSettledBeforeReturnRelease: true`, `returns: 1`. The packed inherited
assertion also remains exit1 after disposal, with the same raw gate state. The
failure text is preserved even though its old wording is stronger than Root's
current contract decision. Both observations are **after disposal**, not evidence
that normal exec fails to await external return.

Root decision `28f13113` says normal column exec awaits external return; disposal
may interrupt an UNREGISTERED return wait. A stronger post-disposal barrier must
explicitly register owned cooperative cleanup. The owned VFS positive still shows
exec/dispose pending until return release. The actual shared return-error swallowing
issue is assigned outside column; this pass neither fixes nor certifies it.

`../current-contract-revision/SPEC.md` prepares the disjoint Root-authorized normal
return/error, raw-unregistered negative and explicitly registered positive cases.
It has **zero executions**: `3af3f628` was not Root-accepted for this pass and was
not substituted for `a8096354`. Original S38/packed assertions and historical
HOLD/37-of-40 evidence are not migrated. Public integration stays HOLD pending
Root's accepted shared candidate and separate immutable revision/replay.

Two audit-harness corrections are preserved in `history/`; neither changes any
product output, oracle or assertion. All 35 owned runtime/build/check process
groups are closed, including deliberately killed negative workers. Archives,
raw inventories, negative sidecars and the moved package remain under
`/tmp/safe-bash-column-padding-MmS9An`. Source work and product execution stop here.
No full gate, comparator, performance run, private checkout or global install is
claimed or left running.
