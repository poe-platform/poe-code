# FOUNDATION allocated-byte metadata author evidence

Core implementation: `a3febbee84e2c1c871376a9d5d30baddb96dae68`.
The source/test/contract commit is independent of this evidence tree. Only
`FileStat`, the Real stat projection, its internal conversion helper, their new
focused tests, and the allocation contract text are changed by that commit.
Wrappers, wrapper type fixtures, commands, exports, capabilities, comparison
authority, and package configuration belong to other owners and are not changed
or certified here.

## Captured result

`author-001/report.json` records **9/9 focused tests and 42/42 unchanged legacy
tests**, with no failures, skips, cancellations, or TODOs. The scoped strict
TypeScript no-emit check and core whitespace check exit zero. All 20 named input
hashes match the core commit before and after execution. No native fixture
directories existed before capture or remained afterward. The live checkout HEAD
was `4f3a3115cf5cdf365ee2877ce04e2ef951aed491`; unrelated concurrent work is not
included in these authenticated inputs or certified by the result.

| Entry | Logical bytes | Native blocks | Reported allocated bytes |
| --- | ---: | ---: | ---: |
| Empty | 0 | 0 | 0 |
| Dense / hardlink | 65,536 | 128 | 65,536 |
| Truncate-only sparse | 4,194,304 | 0 | 0 |
| Hole-written | 4,194,304 | 8,192 | 4,194,304 |
| Directory | 64 | 0 | 0 |
| Symlink, lstat | 5 | 0 | 0 |
| Symlink, followed stat | 65,536 | 128 | 65,536 |

These are this capture's native observations, not portable allocation goldens.

## Reproduction

From the repository root, run:

```sh
node tests/fs/real/allocation-evidence/capture.mjs NEW_UNIQUE_DIRECTORY
```

This is an explicit, candidate-specific capture, outside canonical test discovery.
It refuses existing output directories, retains failures, authenticates named
source/test inputs against the core commit, and records exact commands, exit
statuses, SHA-256 hashes, Git blobs, runtime versions, counts, and native stat
observations. It does not build or modify root `dist`. The canonical tests never
rewrite committed evidence; their only files are uniquely named owned native
fixtures removed through awaited cleanup hooks, including on ordinary failures.
The capture checks that no new `.native-*` fixtures remain.

The inventory re-enumerates the two runtime source directories before and after,
including nonignored untracked additions. Other tests/configs are named inputs,
not an append-proof whole-repository inventory. Execution is in the live worktree
with those inputs authenticated; it is not an isolated archive run or a full gate.

## Native profile and fixture distinction

The local profile is Darwin arm64, Node v22.22.2, libuv 1.51.0. Linux's 512-byte
conversion branch has arithmetic tests and primary-source justification, **not a
Linux runtime witness**. The capture records the native filesystem type number;
it does not infer deployed-provider behavior from it.

The matrix compares Real `stat` and `lstat` with Node's native bigint stat reports
before and after the observation, for seven owned entries (14 observations):
empty file, dense random-data file, truncate-only sparse file, hole-written file,
hardlink, directory, and relative symlink. Identity, mode, and size remain checked;
the native block count is multiplied using bigint in the witness, independently
of the production number-conversion helper. These are native Node filesystem
observations, not a second independently implemented OS executable oracle.

The preliminary nine-test run used truncate plus a tail write for the sparse
candidate. Darwin reported all 4,194,304 bytes allocated. Removing the initial
truncate but retaining the tail write gave the same fully allocated report.
Neither is relabeled as sparse allocation. An owned truncate-only probe reported
zero blocks before and after fsync. The final fixture therefore preserves both:
`sparse` uses truncate only; `hole-written` writes a 4,096-byte tail at a 4 MiB EOF.
Fixture semantics changed before the core commit, not product accounting. The
canonical tests compare actual native reports and do not demand sparse-storage
behavior from every filesystem. All preliminary fixtures were removed.

## Bounds and legacy evidence

Focused tests cover readonly optional typing, unchanged stat/lstat return types,
legacy structural implementations, absence versus known zero, both supported
platform branches, safe-product limits, missing/negative/fractional/nonfinite/
unsafe/overflowing/coercible values, unsupported platforms, native metadata,
typed missing-path errors, and pre-aborted cancellation including errno-shaped
reasons. Invalid native allocation reports omit the optional property rather than
inventing zero; existing stat failures do not become successful unknown results.

The legacy cohort is exactly the existing contract filesystem/identity tests and
Real conformance/cancellation-regression tests. No old golden, captured native
report, diagnostic assertion, or historical source fixture is rewritten. The
old Real metadata-review captures remain historical stat shapes without this new
field; they are not promoted to current allocation evidence. Wrapper fixtures
using `Required<FileStat>` need their separately assigned additive updates.

The source references and exact 512-byte-unit qualifications live in
`src/contracts/filesystem.md`; `sources.json` records the primary URLs and facts.
No physical values are introduced for Memory/S3/WebDAV, and the existing SafeJS
logical-size-based Node-shaped block fields are not allocation evidence.
