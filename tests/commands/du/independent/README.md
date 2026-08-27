# Independent DU verification — bounded, not candidate closure

Independent verifier, not the DU author. Product, contracts, author tests, package
manifest, and root exports were read-only. Only this new subtree is owned.

**Qualified result:** no new unexplained command bug found in this bounded review
of `877144ea3a5223bbdf3e7ebfd50a8f8caaa474f3`. This does **not** close the candidate:
actual Overlay backend mutation and missing public DU exports remain blockers.

## Final capture

`evidence/review-MduamP/` is the final run. Its `manifest.json` binds the exact
Git archive, 257 frozen input files, harness snapshots, toolchain identities,
steps, loaded entry hashes, and post-run checks. `built-files.json` records all
788 generated build files; every one was byte-checked against the extracted pack.
Raw logs and JSON results remain alongside the manifest.

- Darwin arm64, Node v22.22.2, TypeScript 5.9.3, tsx 4.23.12.
- Final execution: August 27, 2026, 17:38:02.318–17:38:16.246 UTC. Earlier
  preserved captures start at 17:28:26.742 UTC. These timestamps record execution,
  not 72 hours of work or project completion.
- Archive SHA-256:
  `c8f214b3fec6aac5ea55e9ffdcc196c5590ea4eb8a16ba001241cf1f1b447432`.
- Unmodified package pack SHA-256:
  `53ab62a59574d79607692ab2d67a22f8825bf7a68b1aa17b59392c9d7cf7bf0a`.

| Cohort | Exact outcome | Qualification |
| --- | --- | --- |
| Frozen author tests | 140 pass, 0 fail, 0 skip | Includes retained RED detection and profile differences; not 140 independent native matches |
| Author scoped types | Exit 0 | Frozen source/tests; not repository-wide types |
| Full source build | Exit 0 | Isolated ESM/declarations, no live dist writes |
| Typed old FileStat | Exit 0 | `allocatedBytes` omitted, still type-compatible; runtime unknown is tested |
| Author built-module probe | Exit 0 | Private built-module/plugin/Shell boundary, not public DU |
| New independent assertions | 50 pass, 0 fail | Includes one RED-property detector, six expected backend allocation refusals, and the mapped-root native assertion |
| New native cases | 115/115 same records, status, stderr; 112/115 exact byte order | Three retained order differences; not broad parity |
| Mapped native root | 1/1 match after explicit path mapping | Native owned absolute fixture path maps to virtual `/`; separate from the 115 |
| Existing packed public Shell/FS | 6/6 workflows pass | Memory, Real, read-only, mount, overlay, S3 mock; **no public DU success** |
| Public DU | Root named import fails; subpath refused; aggregate exits 127 | Existing unresolved integration blocker |
| Isolated source mutants | 6/6 killed; 6/6 baseline assertions pass; 6/6 mutant builds pass | Assertion failures, not compiler failures, kill mutants |
| Strict actual backend no-mutation | **FAIL, preserved** | Overlay deletes pending garbage during DU metadata traversal |

The final runner exits zero for completion of this **bounded review protocol**.
That exit status deliberately does not turn known root blockers into acceptance.

## Original 87-case native evidence

All 87 original GNU cases were replayed from frozen `native-profile.json` without
altering inputs, raw expectations, stdout, stderr, or status. `independent.json`
contains each full native record, actual product result, and classification.

- **72** exact stdout/stderr/status matches.
- **12** diagnostic-only differences: `tree:-s -d0`, `tree:-as`, `tree:-s -d1`,
  `-b missing tree/a`, `-b ` (empty operand), `-b tree/a --unsupported`, and
  `block:b`, `block:0`, `block:-1`, `block:1.5K`, `block:Q`, `block:1Q`.
  The block grammar/range cases fail in both implementations, with identical
  empty stdout and nonzero status. They are **not** newly discovered successful
  GNU formats silently waived in the product. The redundant-depth case differs
  only by GNU's warning. Author exact product diagnostic assertions also replay.
- **2** intentional strict-environment differences: invalid `DU_BLOCK_SIZE=bad`
  and empty `DU_BLOCK_SIZE` with `BLOCK_SIZE=2K`. GNU silently succeeds using its
  observed fallback; the product diagnoses and exits 1 without output.
- **1** intentional namespace-preservation difference: `-b tree tree`. GNU emits
  the first tree only; the product walks the second directory namespace and emits
  its zero totals after file-identity deduplication. Pruning directory identities
  would lose independently mounted children, demonstrated by a separate test.
- **0** unexplained differences in this original cohort. This is **not 87 native
  passes**. These logical-size cases do not establish Memory allocation knowledge.

The author suite separately executes its original **18** live Real/GNU cases.
Those matched in the frozen replay. They are not merged into the 87-case capture
or counted as new independent cases.

## New coverage and retained refusals

The new native fixture is owned and removed. It includes nested directories,
hardlinks, final/broken/cyclic symlinks, a sparse file, a dash-leading name, and
19 logical lengths around decimal/binary rounding boundaries. Tests exercise the
requested common short/long flags, combinations, context environment precedence,
allocated/default and apparent arithmetic, root/path spellings, and no-follow
behavior. Exact raw native and product outputs are retained. Only `-a tree`,
`-ac0B512 tree`, and `--all --total --null --block-size=1 tree` need record-order
normalization; none need size, diagnostic, or status normalization.

Independent command checks cover missing/NaN/negative/fractional/unsafe/infinite/
null allocation even with logical size zero; explicit allocation zero; legacy
typed stats; partial unknown trees; complete siblings; subtree and grand-total
overflow; zero apparent directory contribution; scope/dev/ino trust, distinct
opaque scopes, unknown identity, count-links, and non-pruned mount namespaces.
They also cover reporting depth versus traversal, deterministic UTF-16/NUL output,
parse-before-effects, all nine bounds classes and invalid settings, typed FS
errors, exact abort reasons, synchronous cleanup registration, repeated cleanup,
late host rejection, awaited backpressure, and actual Shell cancellation.

The early-closed `du -ba tree | head -n 1` pipeline settles with the first row,
after 6 metadata calls versus 602 for the full traversal, with no later admission.
No DU-issued FS operation except `lstat` and `readdir` is admitted by the tracer;
stdin/content reads and mutation methods are not allowed.

Memory, read-only, mount, overlay, S3 MockS3Client, and WebDAV MockDav each have an
actual Shell apparent-size success and an explicit default-allocation refusal:
**six expected refusals**, status 1, empty stdout, unknown-allocation diagnostics.
Mock requests stay within S3 HEAD/LIST and DAV PROPFIND for these flows. These
refusals are not universal no-op passes, allocation support, or deployed-provider
acceptance. Real allocated behavior is separately tested against the native oracle.

## The two still-open root blockers

1. **Overlay actual effects.** The unchanged author RED test replays, and the
   independent control repeats it. After an earlier refused garbage cleanup,
   `du -bs tree` calls only `lstat` and `readdir` but an upper `rm` deletes a
   `.virtual-bash-overlay-*` staging entry. Before/after entries, mutation paths,
   command calls, and output are in `independent.json` under `blockers`.
   Relevant frozen code: `src/fs/overlay/index.ts:146`, `:158`, `:361`.
   No provider fix, refusal substitution, or weakened assertion was made.
2. **Actual public DU integration.** The unmodified frozen `npm pack` is extracted
   into a separate consumer package. The consumer asserts that module resolution
   lands inside that extracted package, never live repository self-reference.
   All three DU root factories are absent; a true named `duCommands` import fails
   with `SyntaxError`; `virtual-bash/commands/du` produces
   `ERR_PACKAGE_PATH_NOT_EXPORTED`; actual `agentCommands()` plus Shell cannot
   execute DU (127). The package manifest is byte-identical to the frozen input.
   The consumer's own distinct-name package boundary has no fake exports.
   Built leaf-module success is recorded separately, not used as a fallback.

## Mutant sensitivity

`mutants.json`, individual patch files, and raw build/test logs preserve six
changes made only to disposable source clones: size fallback, zero-row omission,
false global identity scope, unchecked addition, incomplete-total publication,
and disabled output quota. Each exact baseline assertion passes against the
frozen build and fails against its successfully built mutant. Candidate/archive
and live production bytes are never mutated by this procedure.

## Preservation, isolation, and gaps

Earlier attempts are intentionally retained, not rewritten:

- `review-NTFzN0`: preliminary 115-native/one-root capture; no public probe.
  Its three format diagnostics were initially grouped by topic; the later
  classification explicitly puts them among the 12 diagnostic-only differences.
- `review-DBkitv`: 22 assertions pass, then a **harness failure** uses `-bd0c`;
  `d` consumes `0c`, correctly rejected by DU. The intended test was corrected to
  `-bcd0`. Original raw failure remains; it is not a production bug.
- `review-sEhrKt`: 48 assertions pass, but the first packed consumer accidentally
  resolves live package self-reference. Its public results are **invalid as packed
  acceptance**, regardless of coincident hashes. The actual resolved path is
  preserved. A distinct consumer package boundary and resolution assertion fix
  the harness, without changing the product manifest or adding fake exports.
- `review-BCsmta`: corrected packed boundary, 50 assertions, six mutant kills.
  Final `review-MduamP` additionally records toolchain hashes, checks every packed
  build file, disables tsx caching, and redirects child temporary files into the
  owned work root. Earlier attempts did not instrument development-tool cache
  behavior outside their explicit fixture roots.

Final input re-enumeration checks new files/symlinks as well as changed or removed
original files. It excludes exactly `node_modules`, generated `dist`, and the
read-only oracle link subtree; it does not check empty-directory additions or
claim an append-proof entire filesystem. Oracle binary/source have separate
before/after checks. All explicitly owned native fixtures, work roots, extracted
packages, mutant sources, npm cache/config files, and task processes are cleaned.
No download, dependency install, shared-oracle mutation, root config change,
production edit, or live package/dist edit is part of the final protocol.

This is frozen-source, selected-consumer, GNU-on-Darwin and mock-backend evidence,
not a current-HEAD/full-repository gate, GNU/Linux qualification, deployed S3/DAV
acceptance, exhaustive filesystem/flag/failure coverage, performance comparison,
or superiority/completion claim. Packed DAV is not tested; its DU mock flow uses
the built adapter and frozen author mock, separately from packed public checks.

## Reproduce

Run `node tests/commands/du/independent/review.mjs` from the repository. It creates
a unique evidence directory and never rewrites committed captures. Existing local
development tools and this exact read-only oracle must already be available:

`tests/commands/metadata-stress/.oracle/coreutils-9.7/src/du`

The actual realpath/version is authenticated as GNU coreutils 9.7, with binary
SHA-256 `f1df033deed07d208d80128568404c1043b283c59f294164f1240789bfadcf2b`
and `du.c` SHA-256
`3cd1c0120881ba28da3345b1324e9d146f948a95db6ce2900ba27b3fe8f45bf9`.
Frozen `src/commands/du/du.ts` SHA-256 is
`6954f5f86f69ec9aca39f464198d200b0895b6b286df9a5bd08c44444f9b8ca2`;
loaded `dist/commands/du/du.js` is
`022198ae78b24958ce290ce53a7cfb86e19c05b1f04b4094566e36838daf3c4f`.
All other source/build hashes are in the final manifest/build inventory.

The runner is deliberately explicit opt-in, not a canonical `.test.ts` byte pin.
Native records, raw logs, mutant patch text, and harness snapshots are evidence
data (`.json`/`.txt`), not canonical TypeScript inputs or test-discovery fixtures.
The maintained `typed-oldstats.ts` remains part of normal TypeScript discovery.

Final syntax checks pass for all six maintained `.mjs` harness files, and the
final evidence was audited against their recorded hashes and expected counts.
Code/document whitespace checks pass. Whole-owned-tree `git diff --check` reports
ten preserved trailing spaces: two raw TAP lines naming the original empty
`-b ` operand in each of five author replays. Those evidence bytes are deliberately
not trimmed or rewritten to make a formatting check green.
