# Eight-expectation editor handoff: separate full 3758

**Revised full cohort: 3758 pass / 0 fail, 70 filenames, 17 groups, run once.**
No skips, cancellations, TODOs, case filtering, native fallback, or denominator
changes. This is an **expectation EDITOR/author** delivery, not independent review.
The different independent reviewer must evaluate the atomic commit afterward.

**Original3758 remains archived 3750 pass / 8 fail, exit 1; NOT rerun.**
**Original30 remains historical 14 pass / 16 fail; NOT rerun.**
Neither original gate is green. The earlier revised96 remains a separate 96/96
record, not rerun or added to 3758. The prior pruning-adversarial 200-check record
is also separate, not rerun here.

**Full snapshot build is NOT accepted:** exit 2 on unrelated archive-source
typing errors. Scoped original70 `tsc --noEmit` passes. The actual absolute-VFS
fixture passes under plain Node against the emitted snapshot dist; that does
not turn the failed build into a successful build. No product source was edited.

## Precisely eight expectation changes

`manifest.json` enumerates every exact name, original file SHA-256, revised file
SHA-256, versioned delta SHA-256, literal before/after assertion blocks and the
SHA-256 of that case's fresh proof record. Its proof-file hash binds the full
fresh capture. `delta-v1.mjs` is executable, fails closed on original hashes and
unique anchors, and refuses to edit the repository in place. It modifies only
the isolated copy. Reversing each replacement reproduces its original file.

1. `quoted-path security: quoted ancestor symlink`
2. `atomic extension malformed backward-second-hunk is not swallowed after a valid file section`
3. `GNU default: normal/-E/apply`
4. `GNU default: normal/--remove-empty-files/apply`
5. `GNU default: context/-E/apply`
6. `GNU default: context/--remove-empty-files/apply`
7. `GNU default: unified/-E/apply`
8. `GNU default: unified/--remove-empty-files/apply`

These are exactly the eight failures in `371df76`, with correction `cd80ea1`.
Only three generated files differ: `editflows/quoted-safety.test.ts`,
`fuzz/edits.test.ts`, and `emptyfile-delta/emptyfile.test.ts`. All other test
assertions, inputs, flags, fixtures, helpers, product files, runner files and
filenames remain unchanged. No `.test.ts` is added to repository autodiscovery.
The complete original237 test/evidence hashes match `c623665`'s manifest, and
all original70 also match Git `4d4f5ca`, before capture and after finalization.

The quoted expectation now requires status 0, exact stdout
`patching file first\npatching file target\n`, both first and basename target
updated, and the existing `dir/target` and alias unchanged. Every other quote
vector retains its original assertion values. The complete second hunk in the
atomic vector now expects status 1, not syntax status 2; both original
no-publication byte assertions remain. No atomic flag is passed to GNU.

For exactly the six pruning vectors, the expected namespace already removed
`/authorized` but incorrectly retained root nlink 4. The delta changes only
that expected root to 3, inside the existing six-case `prunedParent` branch.
There is no global namespace normalization. The later logged-mutation
expectation changes from `rm(file), rm(parent)` to the correctly observable
`rm(file)`. **The original observer does not record `rmdir`; it was not changed.**
The separate fresh trace proves actual `rm(file), rmdir(parent)`, nonrecursive
options and propagated signals. A passing old observer alone would not prove
parent pruning; complete namespaces and the separate trace supply that proof.

## Fresh executed GNU evidence

`proof.json` contains the exact eight cases, twelve narrowly related controls,
and three exact GNU diff regenerations. These are separate from the 3758 census.
Each exact case has complete before/after file bytes, directory namespace,
symlink targets, hardlink alias classes, nlinks, raw modes, status, stdout,
stderr and consumer calls. Decorated controls retain a two-link sentinel inode
and its symlink. Native namespaces have an outer sentinel and are retained,
not recursively discarded. Native execution is test-only, bounded to five
seconds/64 KiB, with explicit executable paths and namespace-local targets.

Pinned executables fail closed on bytes and version:

| GNU executable | Version | SHA-256 |
| --- | --- | --- |
| diff | GNU diffutils 3.12 | `f13ef516c397b0281818ffe8685aa763100b56a6549295c91849c6af937a83c9` |
| patch | GNU patch 2.8 | `c060444da0e547de6f17594baf0b5015a04f5b3277131ca12b1da27c621aee00` |

Apple diff and patch are separately pinned by the existing oracle; their
original calibration assertions remain untouched. Apple observations do not
provide the GNU expectation proof and are not silently relabeled as GNU passes.
All oracle/runtime binary hashes bracket the captured commands; corrected final
GNU/Apple pin execution matches the fresh proof. No external reference was
needed: the primary evidence is actual pinned executable output.

- Default quoted ancestor: GNU and product both succeed, update `first` and
  basename `target`, and preserve alias plus `dir/target`.
- Explicit `-p0` control: GNU follows the internal ancestor alias, succeeds and
  updates `first` plus `dir/target`. Product returns 2 with no mutations in both
  ordinary and atomic modes. This is the selected-path security extension,
  not a claim that GNU has the same guard.
- Complete misordered second hunk: ordinary GNU returns 1, commits `first` and
  the first target hunk, and creates exact `.orig`/`.rej` bytes. Atomic product
  returns 1, empty stdout, exact hunk-conflict stderr, and no mutations anywhere.
- Truly truncated second hunk: GNU and atomic product return 2. GNU retains its
  earlier `first` update; atomic product preserves the entire original namespace.
- Six removals: GNU and product return 0 with exact normalized stdout and empty
  stderr, remove target and parent, preserve every decoy/alias/sentinel, and
  change root nlink **4 to 3**.

Host directory link counts are **not universally equal** to MemoryFS counts.
The captured native host counts all immediate entries; MemoryFS counts immediate
child directories. The proof records every raw count and independently asserts
each model's complete expected counts rather than dropping directory metadata.
In particular, removing `/authorized` changes the fixture root 4 to 3 in both.
This host metadata distinction is not a GNU-versus-Apple utility exception.

## Full census and immutable execution

The full run used an actual working-tree copy, not a Git archive or the older
source snapshot. Capture verified before/copy/after hashes and copied 318
dependency entries instead of linking to live `node_modules`. Consumer sources
match frozen `/tmp/safe-bash-diff-rmdir-final-PRIFIp`; no consumer fix is hidden.
Other currently authored source is captured honestly, including the unrelated
archive files responsible for the build diagnostics.

The unchanged checkpoint load guard rejects imports outside the canonical
snapshot. No compiled JS shadows exist. Every command has explicit snapshot cwd.
357 distinct modules are audited, including TypeScript consumer source and the
built public entry. Complete source/dependency/input hashes bracket every command
and the supplemental finalization. All compiler calls use `--noEmit`, except the
declared build into snapshot `dist`. The generated scoped compiler configuration
and three expectation files are the only declared input changes.

Existing historical native temp directories and benchmark reports are excluded
exactly as in the prior inventory. The additional exclusion is only the other
reviewer's generated `gnu-revised-full-review/.work` namespace, whose native
symlinks are not product/test inputs. No original237 file or original70 test is
excluded. No reviewer probe was imported or executed by this editor.

| Group | Original census | Revised pass/fail |
| --- | ---: | ---: |
| absolute-target | 30 | 30/0 |
| compatibility | 110 | 110/0 |
| editflows | 31 | 31/0 |
| emptyfile-delta | 89 | 89/0 |
| formats | 1069 | 1069/0 |
| fuzz | 38 | 38/0 |
| gnu-auxiliary | 56 | 56/0 |
| gnu-candidate-followup | 21 | 21/0 |
| gnu-editflows | 75 | 75/0 |
| gnu-safety-strip-followup | 6 | 6/0 |
| gnu-target-classification | 7 | 7/0 |
| gnu-target-followup | 23 | 23/0 |
| gnu-target | 27 | 27/0 |
| parser-regressions | 80 | 80/0 |
| path-regressions | 619 | 619/0 |
| safety | 152 | 152/0 |
| author | 1325 | 1325/0 |
| **Total** | **3758** | **3758/0** |

The archived pre/post census compares **every name, relative filename and
nesting level**, not merely totals. Its denominator is exactly 3758, not 365,
96, 30, or 3758 plus the focused proof controls.

## Results, hashes and non-green build

Evidence: `/tmp/safe-bash-diff-revised-full-T6lPmg`.
Snapshot: `/private/tmp/safe-bash-diff-revised-full-T6lPmg/snapshot-1`.
Proof/full tests/validation: **2026-08-26 23:48:24.932–23:50:31.338 UTC**.
Supplemental hash/pin finalization ends **23:52:33.372 UTC**, without rerunning
any full-cohort case. Node 22.22.2, TypeScript 5.9.3, tsx 4.23.12,
@types/node 22.20.1; no runtime dependencies were added or installed.

- Source before/after: `b8b4cb5827b512b9a7d181ae56fa1325caabc0df7c4aac0cf6ac2fb49503f4f2`.
- Consumer `patch-gnu-paths.ts`: `3a06d5b33d3c0df12ff83b0bbf4396d90906d6fd61e3ca1bd5537f508c4282af`, unchanged from `4009efe`.
- Dependencies before/after: `2ae2d5c2f258eee84f94640fd96662fe98365c4d6e99f6952884afc0bf3f8eee`.
- Delta v1: `dab23166e15d2bc9bbb59ba0441ef7989221ff7e302a994a56c1a5ff5cfba8dc`.
- Fresh proof: `c23323e412724c4c415290998eb1d0e577b76a81079d8968103da8420e47a0e4`.

Scoped original70 `tsc --noEmit` exits 0. Whole-source snapshot build exits 2:

```text
src/commands/archive/internal.ts(91,45): TS2550, string.isWellFormed absent from ES2023 lib
src/commands/archive/stream.ts(9,74): TS2353, highWaterMark absent from ZlibOptions
src/commands/archive/stream.ts(10,49): TS2353, highWaterMark absent from ZlibOptions
```

These were routed through the editor status file immediately; no unauthorized
source or config correction was made. The build emitted dist despite errors.
The unchanged plain-Node public probe resolves snapshot `dist/index.js`, checks
factory and Shell execution, and passes the actual benchmark fixture:

```sh
diff -u --label old --label new old new > change; patch /fixture/old < change; cat old
```

It observes exit 0, exact stdout `patching file /fixture/old\na\nc\n`, empty
stderr and complete expected namespace. This is fixture success, **not** a clean
build claim. `result.json` keeps `allValidationGatesPassed: false`.

## Retained editor-tool failures and supplemental closure

No unexpected full-cohort failure occurred. Preparation/proof development
failures remain accessible and were diagnosed before changing only new tools:

- `FdRQPQ`: capture rejected a native symlink in the unrelated review `.work`.
- `Tje5BS`: new driver attached the consumer hash to `patch.ts` rather than
  `patch-gnu-paths.ts`; no tests executed.
- `6xDgk3`: new proof initially equated native and MemoryFS directory nlinks.
- `AYReHJ`: exact eight succeeded, but the new `-p0` control incorrectly expected
  GNU to reject an ancestor symlink. Observed GNU success is retained, not hidden.
- `IZwsWK`: proof-only 8 exact + 12 controls + 3 regenerations succeeded.
- `T6lPmg`: all 3758 tests and scoped typing passed; build failed as recorded.
  The final pin expression had a missing closing parenthesis in the new driver,
  causing its post-run JSON parse to stop before writing the consolidated result.

The committed driver fixes only that final pin-expression typo relative to its
captured version. `finalize.mjs` separately rechecked unchanged snapshot inputs,
dependencies, original237/70, complete census, dist, imports and corrected pins;
it executed **no tests and no compiler**. The initial failing pin log remains.
`result.json` is the explicitly supplemental consolidated record, not a rewritten
claim that the initial driver or build exited zero.

## Reproduce and read retained evidence

From the repository root:

```sh
node tests/commands/diff-patch-stress/gnu-revised-full/run.mjs
```

This requires the exact existing GNU/Apple pins and historical reference commits
and archive. It copies current real bytes, regenerates the proof, applies the
versioned delta externally, runs all 3758 once, then scoped typing/build/fixture
checks. It exits nonzero for any failed validation gate; it does not substitute
host tools for missing pins. `--proof-only` performs no cohort run. A same-snapshot
finalization without a cohort or compiler rerun is:

```sh
node tests/commands/diff-patch-stress/gnu-revised-full/finalize.mjs /tmp/safe-bash-diff-revised-full-T6lPmg
```

`evidence-archive.json` losslessly retains revised logs, before/after censuses,
input/dependency/source manifests, runtime/import/boundary records, plus original
3758 and original30 raw historical failures. Each gzip/base64 member has its raw
length and SHA-256. List or verify/decode any member to stdout with:

```sh
node tests/commands/diff-patch-stress/gnu-revised-full/read-evidence.mjs
node tests/commands/diff-patch-stress/gnu-revised-full/read-evidence.mjs revised/census.json
node tests/commands/diff-patch-stress/gnu-revised-full/read-evidence.mjs original3758/result.json
node tests/commands/diff-patch-stress/gnu-revised-full/read-evidence.mjs original30/result.json
```

The original reports and runners remain untouched at `gnu-rmdir-checkpoint/`
and `original-thirty-replay/`. Their archives are historical, not fresh reruns.
The separate `pruning-adversarial/` record still reports **S3/WebDAV ENOTSUP as
refusal, not empty-directory capability support**, and overlay outside-contract
child-preservation remains **0/3**, not green or silently omitted. No new
unsupported profile is reclassified. There is no universal GNU/BSD, full-shell,
remote-provider, superiority or 72-hour-completion claim.
