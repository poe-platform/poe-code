# Independent bounded migration/policy audit: `9a5a6f92`

Date: August 27, 2026. Reviewer role: independent leaf, not the author and not
root. This report audits only the four canonical migrations named by
`tests/commands/du/canonical-migration-v1/REPORT.md` and the bounded prerequisite
diffs requested by root. It does not rerun or accept the whole gate, installed
package, original/refined holdouts, or the author's overlapping 191/30/416/six
counts.

## Verdict

The four canonical expectation migrations in
`9a5a6f922beb1bc6ba84a0cd32ea7a12f8ce985d` are technically legitimate for the
stated root policy. The candidate commit changes only the two canonical test
files, its patch exactly matches the immutable patch in
`c5fe1a68341b3a2ebbefd9fee6793a1e6c5df10b`, and the selected exact-archive
candidate run passes 4/4. The exact parent with the new product and old
expectations fails 4/4, while baseline `877144ea` with the old product and old
expectations passes 4/4. No product bug or mistaken fixture was found within the
four migrated expectations.

One source-scope question remains for root. `32c5b60c` catches a selected
environment `UsageError` after selecting any of `DU_BLOCK_SIZE`, `BLOCK_SIZE`,
or `BLOCKSIZE`. Thus invalid/empty selected `BLOCK_SIZE` and `BLOCKSIZE` also
default instead of failing or consulting lower-priority values. Independent
candidate and GNU 9.7 probes agree on those broader branches, so this is not a
semantic defect. However, the supplied authorization clearly names invalid
`DU_BLOCK_SIZE` and is ambiguous about invalid/empty values selected from the
two lower-priority variables. Root should explicitly confirm or reject that
scope; `9a5a6f92` itself did not introduce it.

## Exact four migrations

`BHV-ENV` below is a report-local identifier. The pre-migration aggregate test
had no machine case ID; its exact canonical subtest name was `all argument and
environment validation happens before any filesystem call`. It contains two
environment iterations and is the first of the four migrations enumerated by
the sealed report. O062/O086/O087 are the original 87-case IDs.

| Migration | Exact input before | Old expectation | Exact input/expectation after | Native classification before/after | Judgment |
| --- | --- | --- | --- | --- | --- |
| BHV-ENV | `argv=[]`, empty Memory root; (a) `DU_BLOCK_SIZE=bad`; (b) `DU_BLOCK_SIZE=`, `BLOCK_SIZE=1` | exit 1; aggregate test ultimately expected zero FS calls; stdout/stderr were not asserted for these iterations | `argv=[--apparent-size,file]`; dense 1,025-zero-byte Memory `/file`; same two env maps; exit 0, stdout `2\tfile\n`, empty stderr, exactly `lstat /file` | Aggregate had no native ID. Its behavior maps to G5/O086 and G5/O087, but case (b) deliberately uses `BLOCK_SIZE=1` rather than O087's `2K`. G5 remains retained, not rewritten. | Legitimate targeted fixture migration, not an unchanged-input expectation update. The old input now exits 1 for unknown root allocation after `lstat /` + `readdir /`, so merely changing its status assertion would test the wrong failure. Invalid explicit arguments still use the original empty traced FS and make zero calls. |
| O062 | `argv=[-b,""]`, env `{}` | exit 1, stdout empty; virtual expected stderr `du: "": no such file or directory, lstat ''\n` | Same argv/env/status/stdout; stderr only becomes `du: invalid zero-length file name\n` | G3 before and after: equivalent failure/continuation with a bounded diagnostic-category difference. | Legitimate. It replaces a fabricated ENOENT/lstat diagnostic with the measured native invalid-name diagnostic; no empty/root FS lookup is introduced. |
| O086 | `argv=[--apparent-size,size-1025]`, `DU_BLOCK_SIZE=bad`; native fixture is a zero-filled sparse/truncated logical 1,025-byte file | Old exception expected virtual exit 1, empty stdout, `du: invalid block size 'bad'\n`; frozen native already recorded exit 0, `2\tsize-1025\n`, empty stderr | Exact argv/env/profile bytes unchanged; exception removed so canonical expectation is the existing native exit 0/stdout/empty stderr | G5 before and after: real selected-environment behavior gap in the historical product record. | Legitimate under the explicit invalid-selected-`DU_BLOCK_SIZE` policy. |
| O087 | `argv=[--apparent-size,size-1025]`, `DU_BLOCK_SIZE=`, `BLOCK_SIZE=2K`; same sparse/truncated logical fixture | Old exception expected virtual exit 1, empty stdout, `du: invalid block size ''\n`; frozen native already recorded exit 0, `2\tsize-1025\n`, empty stderr | Exact argv/env/profile bytes unchanged; exception removed so canonical expectation is the existing native exit 0/stdout/empty stderr | G5 before and after. The selected empty value defaults; lower-priority `BLOCK_SIZE=2K` is not consulted. | Legitimate under the explicit selected-empty/no-lower-priority policy. |

The behavior migration changes argv and fixture, and this report does not call
that unchanged-input proof. Its dense zero bytes and the native profile's sparse
zero-filled logical bytes are not identical physical fixtures. Both O086/O087
use explicit apparent size, so their output depends on the authenticated logical
size, not allocation. The canonical native profile itself is byte-identical to
the original captured profile.

## Independent executions

The harness extracted three exact `git archive` snapshots, linked installed
`tsx` 4.23.12 only as read-only tooling, and ran the named behavior subtest plus
only O062/O086/O087 from `native.test.ts`:

| Snapshot | Product/tests | Selected result |
| --- | --- | --- |
| `877144ea3a5223bbdf3e7ebfd50a8f8caaa474f3` | baseline product, original test blobs | 4 pass, 0 fail |
| `31f5678e62e3f3d43b4825d839ec970e7768da7d` | fixed product, original test blobs | 0 pass, 4 fail |
| `9a5a6f922beb1bc6ba84a0cd32ea7a12f8ce985d` | fixed product, migrated test blobs | 4 pass, 0 fail |

Every tracked archive entry, including symlink blob payloads, was hashed before
and after. Baseline 28,641, parent 30,778, and candidate 30,778 tracked entries
were unchanged, with no new non-tooling entries. The temporary archives,
fixtures, and native scratch were removed. `RESULTS.json` records exact commit
parents/trees, archive hashes, test selectors, statuses, output hashes, and the
append check. Raw TAP is retained under `raw/`.

The relevant native cases were also reproduced with the read-only Darwin GNU
coreutils 9.7 oracle using `PATH=/usr/bin:/bin`, `LC_ALL=C`, exact case env, and
a task-owned 1,025-zero-byte file. Binary SHA-256 before/after was
`f1df033deed07d208d80128568404c1043b283c59f294164f1240789bfadcf2b`;
`du.c` SHA-256 was
`3cd1c0120881ba28da3345b1324e9d146f948a95db6ce2900ba27b3fe8f45bf9`.
O062/O086/O087 matched the frozen native status/stdout/stderr exactly. This is a
Darwin GNU 9.7 observation, not a GNU/Linux or universal parity claim.

## Authentication and preservation

- Candidate parent/tree: `31f5678e62e3f3d43b4825d839ec970e7768da7d` /
  `62c1b2f2784ca465b17d4b15a5736c42b8bdcf2d`.
- Immutable evidence parent/tree:
  `87833f33cb7fa6d2a6c098201dd53fe5404a7fcb` /
  `5c0924f929fb9851bab50f5cd5d9b00c023314c2`.
- Original `behavior.test.ts` and its sealed `.txt` are the same Git blob
  `56e31dfb0beaa95690d8fb9609b3a3863abe1c6b`; original `native.test.ts` and its
  sealed `.txt` are blob `05e07946d5ab3e34e725bc10a022c96871d335ce`.
- The retained raw 5-pass/4-fail TAP is blob
  `6d52533a0cf58be945b7093725a1deea75ac060f`, SHA-256
  `322315edac390ced29d2e8c887ec3a077229f2b7b8c020057c95346fab3c219e`.
- The candidate diff and sealed migration patch are byte-identical, SHA-256
  `2ed5d4ff0b013de9b7b3960444dc8bc0ef090c98f8473ea87334f7f66d489e4f`.
- Canonical/original native profile is blob
  `8f9964c0ea31cae6035560cce60be47d31de6c5f`, SHA-256
  `f3c76252370ed72020de8ae6ede90093b0bdb098047c359f2deb088b4e4f8653`.
  The 36-case functional native observations remain blob
  `8bcc4c2eb2b592a886ed133e7319488e3f01281b`; classification raw remains blob
  `56d993159b14890bbdc07285920e23bcf9e64ddf`. The three native ordering
  differences therefore remain retained and are not relabeled as parity.
- The exact old-Overlay strict red is retained at `0d6b9fcf` as blob
  `3d9971395ef758fbcb55e32d8d07400f00fd46bb`, SHA-256
  `a17e44c8290ae7419ff9aa4160d48ad378fff67ef60327f501f4067725ccecb7`:
  11 pass/19 fail, including all four DU views with observed staging-root
  removals. The explicit-cleanup fixture migration is separately retained as
  blob `4830023eb3115bf8fe1266a65082ee5d98e97080`.

## Bounded product/policy diff

- Overlay `1c793b93` changes only public `readdir` from the default
  `run(..., cleanup=true)` to `run(..., false)`, matching stat/lstat. Internal
  listing, content reads, mutations, run's default, staged finally cleanup, and
  explicit `cleanup()` are unchanged. The exact Overlay product blob at the fix
  and candidate is `fb6d3dc25b5ac29f3adf3b2078b5dbf2e9053d37`.
- Fixture `0d6b9fcf` changes the two positive controls from readdir-triggered cleanup
  to explicit cleanup, while asserting readdir itself makes no removals. The old
  red bodies/results and the full migration patch remain separate, as above.
- DU `32c5b60c` adds only the selected-environment `UsageError` fallback in
  `arguments.ts` and the empty-display diagnostic branch in `du.ts` (plus scoped
  documentation/tests/evidence). Candidate uses the exact fix blobs
  `1b39e18e95d7b19df4c5e01aab8311905137c0e6` and
  `dad87ea613a2c8973c26422c554b39d1826fff69`. Environment byte/work checks are
  outside the catch; explicit invalid `-B bad` independently remained exit 1,
  empty stdout, exact diagnostic, and zero FS calls.
- O060 is not implemented. Candidate probe `-b tree tree` still returns
  `5\ttree/sub\n8\ttree\n0\ttree/sub\n0\ttree\n`. Deterministic order is also
  unchanged: files created `z,a` were reported `a,z`. Source still excludes
  directories from duplicate pruning and sorts child names.
- Root `src/index.ts` and `package.json` are exact baseline blobs
  `efa79f233dde5b62e7044e528b0fc2426e2fe065` and
  `c821769405cc40b17eb2fcec860a97728f128268`. `src/commands/du/index.ts` exists
  for direct module use, but DU is absent from the root/default command
  composition and package export map. No public/default or installed-package DU
  claim is made.

## Policy question for root

Confirm whether the selected-environment fallback policy is intentionally
generic across all three precedence variables. On this candidate:

- `BLOCK_SIZE=bad, BLOCKSIZE=1` -> exit 0, `2\tfile\n`, one lstat; GNU 9.7 agrees.
- `BLOCKSIZE=bad` -> exit 0, `2\tfile\n`, one lstat; GNU 9.7 agrees.
- Empty selected `BLOCK_SIZE` and `BLOCKSIZE` follow the same default rule; an
  own `POSIXLY_CORRECT` selects 512-byte default units.

If authorization was meant to cover only `DU_BLOCK_SIZE`, the source is broader
than approved even though it is GNU-correct. This audit makes no product repair.

## Index and limits

At task start, unrelated staged `safejs-owned-output-prototype-review` files
were observed and left untouched; another owner committed/cleared them during
the audit. Immediately before this leaf's explicit staging, the foreign staged
raw-diff hash (excluding this owned directory) was the empty SHA-256
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`;
the complete index-entry hash was
`6d83e34fdf0a4a632daf1a6b89aa303f37ff987984343bbe4089702a9455678b`.
The pre-commit and post-commit foreign-index checks are reported in the handoff;
this leaf stages/commits only explicit files under this directory.

The author-recorded 191 DU, 30 Overlay strict, 416 Overlay focused, scoped
types/build, and six built-plugin checks overlap and were not independently
rerun here. They are not summed or promoted to a whole gate. Public packaging,
installed-package behavior, service backends, universal native parity, and
project superiority remain outside this bounded audit.
