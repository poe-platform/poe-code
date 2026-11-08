# Independent data-loss closure — current source 4fa4ba9

## Verdict and scope

**The specified alias data-loss regressions close on pinned source
`4fa4ba9502dac843bd13aa5031d128a3171f597d`. Broader acceptance remains RED.**
Curie's `fa539de` identity contract is authoritative. `57d9d98` is an intermediate
source revision, not this checkpoint's final validation target. Its unfinished
independent tests were retained and extended; there was no completed frozen
57d9d98 capture to relabel. The author's `0db472a` evidence was read for scope and
history, not substituted for independent execution.

All edits and artifacts belong only to `tests/fs/mount-identity-review/`.
No delegation, product/contracts/author-test changes, expectation weakening,
dependency installation, or additional backend implementation occurred. All
eleven existing review files from the `0dc247e`/`8d461cc` checkpoints, including
the historical nine-loss and native mutation evidence, remain byte-identical.

The main capture ran August 26, 2026, **18:56:52–18:57:26 America/Chicago**;
the short-path native rerun and seven-FS typecheck finished at 18:59:36. Raw UTC
timestamps, executable paths, argv, exit status, stdout/stderr, test inventories,
source/test hashes and process snapshots are retained in
`evidence/closure-4fa4ba9/`. Tooling was Node 22.22.2, TypeScript 5.9.3 and
tsx 4.23.12 on Darwin arm64, using existing development packages only.

## Immutable fixtures and reproduced closure

The **actual three fixture files** were compared across `029d67e`, the preserved
required49 reproduction manifest, and `4fa4ba9`. All Git blobs and SHA-256 hashes
match. The original4 also matches its original `d4f5e53` bytes. No fixture overlay
or expectation change was needed for these cohorts:

| Fixture | Unchanged Git blob | SHA-256 |
| --- | --- | --- |
| mount/copy-identity.test.ts | `74226fad3afb74b882f4ae7cf53d05cf309b5d97` | `e752e633abc902025670c09305c09e7319b171549350ddec7573b6644d29d115` |
| mount/copy-identity-guards.test.ts | `25d4e7bd19efa9cb09b25d0ed2d8c3074d4c32a9` | `bd8074c17c5e0fc418a5408028b409946b2178e64fad29bfa87c5f8aa1eb8027` |
| overlay/copy-identity.test.ts | `25dc873c3ea16bed26831b0e71bba0d1ae48a83d` | `d877488ecc76799552313b55db0119c83ecf433ad17ceb88079fa0d9bddd872e` |

| Cohort | Before | Independent fixed-source result |
| --- | --- | --- |
| Original4, exact unchanged tests | Fresh 029d67e: 1/4, three failures | **4/4** |
| Required49, exact unchanged tests | Fresh 029d67e: 11/49, 38 failures | **49/49** |
| Independent19, exact unchanged tests | Preserved baseline: 10/19, nine actual source losses | **19/19** |
| Independent native12, exact unchanged tests | Preserved 5a6caff: 12/12 | **12/12** |
| New independent contract-edge tests | Not a historical cohort | **18/18** |
| Independent19 + edges after all source restorations | Mutation recovery repetition, not new coverage | **37/37** |

Each listed source/cohort combination ran once. Original4/required49 are subsets
of the full FS suites below; do not add them again. The 38 historical failures
were required-red cases of mixed kinds, including constructor rejections—not
38 independently observed truncations or regressions from formerly green tests.
The original independent19/native12 files were neither changed nor weakened.

The eighteen new tests check unknown and malformed scopes in both copy
directions, negative device/inode values, unsafe/missing/nonfinite coordinates,
truthfully disjoint stores with colliding metadata, object-token comparison
without coercion, prototype getter forwarding, repeated-backend construction,
actual overlay backing after copy-up, default missing-target races in streaming
and buffered paths, and direct/overlay cancellation with an `ENOENT`-shaped
caller reason. Directional/phase observations are not inflated into extra test
counts. A dedicated same-mount opaque backend has a deliberately unsafe generic
`copyFile`; the fixed mount rejects before calling it.

## Storage safety and source audit

The classifier requires an object/symbol scope and **both nonnegative safe
integer coordinates**, comparing with `===`. Native adapters share
`Symbol.for("virtual-bash.fs.native")`; independent memory stores publish
independent scopes. Unknown identity cannot justify truncating an existing
destination, even if its backend exposes a generic `copyFile` method.

The final `4fa4ba9` delta moves the unknown-identity rejection **ahead of**
same-mount backend delegation. The new regression confirms `ENOTSUP`, exact
public operands, unchanged bytes/namespace and zero source-acquisition/write/
delegate calls. Reintroducing the previous ordering causes measured source
truncation; validating 57d9d98 alone would miss this closure.

Repeated backend instances are now accepted by the mount constructor. This is
an **intentional public-input expansion**, not an unchanged constructor test.
`mount.test.ts` removes backend-uniqueness rejection expectations, retains
duplicate/normalized-path rejection, adds a shared-store copy guard test, and
updates the nested-alias expectation. The raw diff is preserved. Independent
checks accept two routes to one backend, reject a hardlink copy before effects,
retain distinct-file copies, and still reject duplicate normalized mount paths.
The storage invariant is same-entry protection, not adapter-object uniqueness;
the latter never protected overlapping separate real instances. These checks
support the change without claiming every possible mount composition is proven.

Readonly/mount/overlay snapshots forward the selected backing scope, including
prototype/nonenumerable properties. Overlay metadata/path reads no longer clean
pending garbage during alias preflight; direct overlay copy delays cleanup until
after identity checks. Independent copy-up checks first reject a lower alias,
then observe upper identity after publication, and permit a genuinely distinct
subsequent copy while preserving its source. Full overlay and author pending-
garbage tests also run without modification.

The former TS fixture errors are coherently fixed, not hidden: readonly's
`Mutable<Required<FileStat>>` initializer gains a symbol; overlay's required
metadata initializer gains a symbol and `GetterStat` forwards it. Mutation tests
change the scope with another symbol separately from numeric fields. Required
types remain required. Both full runtime suites and strict noEmit checks pass.

## Isolated mutation proof

Every mutant runs only in an owned archive, invokes the real public mount copy
method, preserves test expectations, and passes its own strict noEmit check.
Exact edits, source-before/mutant/restored hashes and raw TAP are recorded in
`mutation-provenance.json`; selected byte effects and call traces are indexed in
`mutation-effects.json`. All source files are restored and hash-checked after
**each** mutant, followed by a clean 37/37 regression rerun.

| Deliberate source mutation | Pass / total | Actual observed regression |
| --- | --- | --- |
| Remove mount same-entry guard | 10/19 | Nine alias cases lose source bytes |
| Allocate native scope per adapter instance | 12/19 | Seven real/wrapper alias cases lose source bytes |
| Drop readonly scope forwarding | 34/37 | Three error/metadata failures; no observed destructive alias copy |
| Drop overlay scope forwarding | 32/37 | Five error/metadata failures; no observed destructive alias copy |
| Remove unknown-identity rejection | 8/18 | Nine forbidden target overwrites, plus same-mount alias source loss |
| Remove exclusive creation for default missing targets | 16/18 | Streaming alias race loses source bytes; buffered case wrongly succeeds without source byte loss |
| Delegate generic same-mount copy before unknown guard | 17/18 | Alias source and target become empty |

**Seven of seven mutants are detected**, not seven arbitrary failing processes:
they typecheck, run the expected test denominators, retain passing controls, and
fail semantic assertions. There are zero mutant skips/cancellations/TODOs.
These are distinct mutation mechanisms, not additive unique alias-case counts.

For the destructive cases, actual traces show source stream acquisition, target
write entry, then lazy source iteration returning no original bytes. Both
source/target snapshots retain exact base64 payloads and namespace/inode data.
The generic-delegation trace additionally records the unsafe `copyFile` call.
Readonly/overlay forwarding mutants instead fail closed or fail initial metadata
assertions; their failures are **not labeled byte loss**. The old native direct-
copy guard-removal experiment remains a separate error-only kill on this host:
the new native-*scope* mutant loses bytes through cross-mount streaming, not by
claiming that prior native no-op behavior changed.

## Full FS and safety snapshot

All existing seven FS groups ran, as did shared conformance and existing safety/
integration suites. These are independently reproduced results, not author totals.

| Frozen 4fa4ba9 gate | Pass / total | Status |
| --- | --- | --- |
| Memory | 88/88 | PASS |
| Real | 94/94 | PASS on unchanged-suite short-path rerun; initial harness result retained |
| Mount | 173/173 | PASS |
| Readonly | 103/103 | PASS |
| Overlay | 184/184 | PASS |
| S3 | 179/179 | PASS |
| WebDAV | 324/324 | PASS |
| Seven FS subtotal | **1145/1145** | Counts the final real cohort once |
| Shared conformance | 202/202 | PASS; separate cohort |
| Adapter safety/stress | **98/99** | RED; S3 optional-metadata expectation |
| Original S3 policy | 42/42 | PASS |
| Bounded S3 policy | 44/44 | PASS |
| Remote cancellation | 24/24 | PASS; original runner, one verbose repetition |
| Revised adapter matrix | **77/79** | RED; unchanged S3/WebDAV safe-rmdir gaps |
| Independent diagnostics | 8/8 | PASS; separate from original matrix |

No runtime skips, TODOs, cancellations or watchdog kills occurred. The five local
groups sum to 642/642, independently reproducing that author subtotal; it is
already included in 1145 and must not be added again. No assertion, unsupported
feature or provider limitation was removed from any denominator.

The initial real suite was **93/94**: its Unix socket fixture failed in
`server.listen` before product assertions, using a 141-byte path underneath the
deep archive TMPDIR. The complete unchanged 94-test suite then passed with
TMPDIR at this owned subtree, producing a 101-byte socket path. No source or test
was patched. Both raw runs, environment difference, matching archive hash and
fixture hashes remain in `socket-path-recheck.json`; the initial result is not
silently rewritten. Fixture directories and tool caches created by that rerun
were cleaned, without touching foreign files.

The safety failure is `s3: optional metadata capabilities are exercised or fail
closed`: the old required rejection of `writeFile(..., {mode: 0o600})` is absent
(`tests/stress/adapters/core.test.ts:39`). It is preserved RED, not waived as a
capability skip. The matrix's two exact failures are safe `rmdir` returning
`ENOTSUP` for `/work/scratch/nested` on S3 and WebDAV. The historical ORIGINAL
diagnostic matrix **71/79** remains separate and was not rerun or rebaselined.
The newly passed diagnostics8 does not turn either matrix denominator green.

## Types, live state and processes

Frozen independent noEmit, five-FS/imported-type noEmit, seven-FS noEmit, and all
seven mutant noEmit checks pass. Source/test inputs in the archives remain
hash-stable. There are no live FS/contract differences from 4fa4ba9 at the final
captured status; unrelated owners continue changing other areas.

Global `npm run typecheck` is a **moving-worktree observation, not a frozen pass**.
The earlier attempt exits 2 with three unowned archive-command diagnostics.
The later attempt, August 26 at **19:03:34–19:03:37 America/Chicago**, also exits 2:
eight diagnostics occur in `src/commands/table-text/comm.ts:20` and
`tests/commands/archive/safety.test.ts` (lines 31–35, 153 and 168). Three archive
source files change hashes during that check, so it is explicitly **not a
coherent committed-HEAD gate** or proof those diagnostics persist after the
owners' next edits. No unrelated errors were fixed here. Both attempts and the
later before/after type-input manifests are retained; the former readonly/
overlay fixture errors do not recur in either.

The final captured live HEAD is `6df52ef13b40d0f51f0a610063b33cb3fcd7eef0`, not the
FS test pin. Raw current status and process command lines are in `final-state.json`.
Six native Codex exec processes were observed: this leaf **20807**, independent
positive acceptance **21747**, shell invocation author **26965**, an exec without
an output-file argument **32102**, tar author **36630**, and integration review
**70980**. These are observed processes, not claims that all are still running
when the report is read. No foreign process was stopped; launched validation
children exited. Original eleven artifacts are unchanged and no owned temporary
archive/native-fixture directory remains. Post-commit owned status is checked
separately from these pre-commit snapshots.

## Exact source and evidence hashes

`provenance.json` contains the complete explicit input manifests, Git blobs,
regular archived source copies, fixture comparisons, source/constructor/test
diffs, archive hashes and tooling hashes. Only cached development tooling is
symlinked; product imports resolve to archived source, not live source aliases.

| Pinned file | SHA-256 |
| --- | --- |
| src/contracts/filesystem.md | `13d82a1a15d9b86370cd54c904608e8eed37da63e5ce05e754dc6e53f0ff821e` |
| src/contracts/filesystem.ts | `fc3c8ee2c6d2d1dade397567779543a38a4fb0092a7225975fecf7cfd553b915` |
| src/fs/mount/identity.ts | `a561928d082232d034c436a89a63b85e5f137c82879281adc9f6aacfcb54d2d2` |
| src/fs/mount/index.ts | `192ada25798791dcb7cf6c3f323ba3a64b814c75e749ae1cea13937de238ccc7` |
| src/fs/real/index.ts | `d3e79b80a5a48984e1f7f7dd9a79254c2db1faf8142e287a43792180874f77da` |
| src/fs/memory/index.ts | `98704037c57bae8bd5c3782c65aceb98e967837df375b33eda52a00ce762b1a0` |
| src/fs/readonly/index.ts | `d0f7f3a36ffcf1da880b40b992f7119d6bf3364542429f8494ecf730c7137ff3` |
| src/fs/overlay/index.ts | `e11852648b374be8991747467c911c34ae1de827d8eb3cf336d0d439e9a978de` |

Primary evidence SHA-256:

- `provenance.json`: `e550a052371990118081d3daec3c95b4c5b91c3af9c1b77b80dcfd21064f43d2`
- `mutation-provenance.json`: `d4657755a293b60a9cd5f70004fcb72b4e23a61a10842c385f60026a4e78d323`
- `final-state.json`: `40b802bbe7bf1be7d89b9aa5b288cb4b442a12b7bacd085fe71e45e304789de5`
- `artifact-index.json`: `a0e9219aa099b816476849344bdad8a2e367f0a9a38c5cfd6d8204093f6e3fa6`

`delivery-index.json` adds hashes for the final report, cleanup evidence and
delivered independent harnesses without rewriting the earlier artifact index.

## Reproduction and remaining limits

`node tests/fs/mount-identity-review/closure-capture.mjs NEW-LABEL` records the
same explicit source pin, old/fixed cohorts, mutations, broad safety and live
type snapshot. It refuses to replace evidence. Its recorder exit is not an
overall acceptance flag: inspect every recorded exit/count. The native socket
path correction is separately reproducible with
`node tests/fs/mount-identity-review/closure-supplement.mjs NEW-LABEL`;
published labels are write-once. Main capture's
deep TMPDIR limitation and initial failure are deliberately preserved rather
than rewriting historical runner hashes.

This closes the measured observation-time alias failures, not pathname races,
ABA/inode reuse, leases, transactions, malicious adapter claims or universal
utility/backend parity. Unknown remote identity still needs a truthful shared
authority; provider/client objects, hashes and ETags are not that authority.
Existing post-stat external-writer windows remain. Overlay immutable-lower and
exclusive-upper prerequisites remain. Genuine disjoint destination failures may
leave partial destination bytes. No superiority or full-product claim follows.
