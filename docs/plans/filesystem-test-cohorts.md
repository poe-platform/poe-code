# Filesystem test cohorts

## Scope and eligibility

Only direct tests in `packages/safe-bash/tests/fs/memory` and
`packages/safe-bash/tests/fs/readonly`, new direct aggregates, and this plan are
owned. Production, helpers, characterization files, evidence, historical
bindings, and other agents' cohorts remain unchanged. No Git or raw lint.

Candidate: one memory implementation/contract cohort containing `memory`,
`conformance`, `review-regressions`, `rmdir`, and `late-authority`. Rename each
`.test.ts` body byte-for-byte to `.cases.ts`; add a static-import-only
`memory-core.test.ts`. Preserve every registration, assertion, import binding,
and within-case operation. Per-file process isolation intentionally becomes
per-cohort process isolation for these five files only.

The five modules have case-local filesystem instances and overrides, no global
hooks, host filesystem/native operations, timers, self-filename reads, or process
mutation. Module-level typed-array fixture inputs require repeat/state controls.

Excluded:

- Memory `comparison.test.ts`: the current-tree
  `tests/fs/mount/mutation-identity.probe.ts` copies and selects its exact path
  for two mutation controls. No consumer edit or binding change is authorized.
- All readonly tests remain unchanged. Six are explicitly selected by the
  current-tree `tests/fs/overlay/allocation-evidence/capture.mjs`, which also
  resolves and hashes their TypeScript closure. Metadata-purity capture and
  other verification consumers add bindings. `streaming.test.ts` additionally
  uses real host temporary directories and a context cleanup hook. The remaining
  `conformance.test.ts` alone offers no process-count reduction; no cross-family
  aggregate is introduced just to move it.
- Historical evidence contains original-path manifests. These are neither
  rewritten nor claimed to authenticate the moving checkout. The five selected
  paths have no literal executable/config consumer in the repository-wide
  old-path search; this is not a claim about arbitrary external consumers.

## Qualification sequence

1. Capture original serial baseline output, exact names/counts and body hashes.
2. Observe a failing single-cohort discovery assertion before renaming.
3. Make byte-identical renames and the five-import aggregate; verify discovery
   changes only by replacing the five paths with one.
4. Run forward/reverse/repeated cases with state/resource observations and
   deliberate observer-negative controls. Check failure names/body attribution
   and maintained quiet reporter output retention without retained probe code.
5. Counterbalance serial isolated-body versus aggregate timings using the same
   current body paths and uncached TypeScript transforms. Keep only a material
   gain with all original cases preserved.

## Qualified result: one logical memory improvement

Ready for parent review and commit; caller files are frozen after this handoff.
Five byte-identical renames plus one five-import aggregate preserve all **105
registrations / 105 unique names**. The retained comparison entrypoint adds 26
cases: the final complete direct-memory selection passes **131/131**, with zero
failures, cancellations, skips or todos. No readonly cohort is submitted.

The aggregate imports conformance, late-authority, memory, review-regressions,
and rmdir in that order. Node 22.23.2 sorted the original explicit file arguments
before serial execution; this order matches the observed baseline exactly. An
initial investigator assertion that concatenated individual files in a manually
chosen different order failed; it was corrected to Node's observed order, not by
changing cases, assertions, names or runtime behavior.

### Exact files and immutable body identities

Paths below are relative to packages/safe-bash. Every renamed body's bytes match
the pre-edit capture, including import specifiers and source line numbers. The
original and new paths share their directory, preserving relative source bindings.

| Original | Renamed body | Cases | SHA-256 (both bodies) |
| --- | --- | ---: | --- |
| `tests/fs/memory/conformance.test.ts` | `tests/fs/memory/conformance.cases.ts` | 13 | `5f945854f3ca15de3426c3e52b20e51d2b00d74a187c8205ce9efa43bd046403` |
| `tests/fs/memory/late-authority.test.ts` | `tests/fs/memory/late-authority.cases.ts` | 17 | `b55b0941fa56ca56bf16b96413acd6f52af70b0d1012d17676c6f6771de10ad5` |
| `tests/fs/memory/memory.test.ts` | `tests/fs/memory/memory.cases.ts` | 41 | `e2317debbaaeb536da43e869940d7a2645e5c8fa4666662d0bed03dc7c279a44` |
| `tests/fs/memory/review-regressions.test.ts` | `tests/fs/memory/review-regressions.cases.ts` | 23 | `02e3d704c35061dd656fade96622e8893edb9c3817b3c5408cb93ba4d2387c48` |
| `tests/fs/memory/rmdir.test.ts` | `tests/fs/memory/rmdir.cases.ts` | 11 | `b50c0d3340d8589ab54a04469394576fe627c4ced7d62f8cf3f2148207de3cce` |

Added aggregate: `tests/fs/memory/memory-core.test.ts`, SHA-256
`471a9030e45919070090c3646658341b0c8b4ed2fe15c539de7ab503edf10ec3`.
The only added executable statements are five static side-effect imports.
The eight excluded direct test bodies (memory comparison and seven readonly)
still match their pre-edit bytes. No helper, characterization, production,
reporter, evidence or historical binding was edited.

### Discovery and active consumers

The single-cohort discovery assertion failed before implementation because all
five original entrypoints remained. After renaming it passed, and the complete
then-current discovery list differed exactly by removing those five paths and
adding memory-core.test.ts: **533 -> 529**. No discovery exclusion, runner option
or concurrency setting changed. Main TypeScript configuration parsing still
includes all five .cases.ts bodies and the aggregate, with no parse diagnostics.
This is an inclusion check, not a full typecheck claim.

At final handoff discovery reports **536**, reflecting seven concurrent shell
entrypoint restorations outside this work. Comparing with the post-rename list
shows those seven additions and no removals; the owned memory delta is still
**6 -> 2** direct entrypoints, while readonly retains all seven. Those unrelated
shell files were not edited by this worker.

The final repository-wide search includes hidden configuration and excludes Git,
dependency and generated dist trees. Searching the five original full paths and
.js equivalents finds 287 files, but **zero executable/config consumers**. They
are historical data/document references, not a license to rewrite or reseal
those inputs. A second basename-only search inspected 24 code/config matches:
all refer to other backends, safe-js conformance, unrelated test names or comments;
none constructs a selected memory path. The existing boundary/config owners do
not name the selected files. This is bounded repository evidence, not proof
about arbitrary external consumers or dormant dynamically constructed protocols.

Readonly's current-tree allocation capture explicitly selects six readonly
paths and constructs a fresh TypeScript-resolved source/hash manifest from them;
metadata-purity capture adds exact bindings. Memory comparison is copied and
selected by the current-tree mount mutation probe. These consumers are not
silently treated as historical merely because their directory names mention
'evidence' or 'probe'. They remain untouched with their targets intact. Pinned
historical manifests and protocols also remain unchanged.

### Baselines, repeat isolation and observer controls

Node **22.23.2**, darwin arm64; every measured child uses
TSX_DISABLE_CACHE=1. Three original-path serial sweeps each pass 105/105 with
identical ordered names and empty stderr. External wall times were
1418.143, 1097.982, 1075.436 ms.
Five individual-file runs also pass; concatenating their emitted names in the
observed Node order reproduces the same 105-name sequence. The initial real
aggregate passes 105/105 with that exact sequence.

A temporary in-memory import hook captures the real node:test callbacks from
these five modules without executing them during collection. The original
modules and source dependencies are loaded normally through tsx; no substitute
filesystem implementation is used. The collected callbacks then execute under
real node:test contexts **forward, reverse, forward** in one process, reusing the
same module closures and typed-array fixture constants: **315/315**. This was
repeated successfully after the rebase. Each phase's emitted names is checked
against the corresponding baseline order. No harness file or reusable framework
is added to the repository.

Every callback is bracketed by state/resource observations after two event-loop
settling turns: cwd, environment, global property descriptors, Object/Array/
Promise/Uint8Array prototype descriptors, process listener identities, open
/dev/fd descriptor metadata, and tracked async resource identities. Tracked
resources include timers (including unref timers), immediates, filesystem
requests, pipes, TCP/server/UDP handles, processes, workers, message ports and
filesystem watchers. The observer's own settling immediates are excluded from
its async resource census, not candidate-created resources. No test-owned delta
remains after a callback. These host-local observations are not a universal
resource-isolation proof.

Seven deliberate leak controls validate the observer, each rejected and cleaned:
unref timer, open /dev/null descriptor, process listener, environment mutation,
global property, prototype property and cwd mutation. They do not change any
production file or persist any host fixture. The ordinary cohort introduces no
global hooks; all observer hooks exist only in the qualification subprocess.

### Failure attribution and full output retention

Twenty qualified subprocess probes cover four modes for each renamed body:
explicit TAP isolated failure, explicit TAP aggregate failure, maintained quiet
reporter aggregate success with fixture stdout/stderr, and quiet aggregate
failure with the same payloads. A bounded in-memory module-source override
injects a complete JSON/binary-array/repeated-receipt stdout payload plus stderr
and, for failure modes, a deliberate throw into the first callback site. No
on-disk fixture, assertion or source body is modified for these probes.

All successful quiet runs suppress the injected fixture stdout/stderr; every
failed run retains the complete untruncated payloads and error. Explicit TAP
retains every original registration name, and isolated/aggregate failure names
match. Source maps attribute failures to the real renamed body and original
callback line rather than only the aggregate:

| Body | Callback line | Deliberately failed cases per run |
| --- | ---: | ---: |
| `tests/fs/memory/conformance.cases.ts` | 21 | 1 |
| `tests/fs/memory/late-authority.cases.ts` | 25 | 12 |
| `tests/fs/memory/memory.cases.ts` | 15 | 1 |
| `tests/fs/memory/review-regressions.cases.ts` | 28 | 5 |
| `tests/fs/memory/rmdir.cases.ts` | 8 | 1 |

The 12 late-authority and five review failures are generated variants sharing
the injected callback site, not lost/deduplicated registrations. All unmodified
runs pass. Early injector-routing attempts did not reach the callback and were
rejected as invalid controls (ordinary green exits), never counted as successful
failure qualification. A loader-boundary negative control established reachability;
the final precise-path in-memory override demonstrably throws at the intended
case source location. Genuine diagnostics/reporting policy are unchanged.

### Final serial counterbalanced timing

One warmup per layout precedes six alternating-order pairs. Isolated mode names
all five current .cases.ts bodies directly, giving five Node test processes;
cohort mode names only memory-core.test.ts, giving one. Both execute the same
current body bytes with --test-concurrency=1, default file isolation, explicit
TAP and uncached tsx transforms. Every run passes 105/105 with identical ordered
names and empty stderr. No runtime concurrency changes are introduced.

| Pair | Order | Isolated wall ms | Cohort wall ms |
| --- | --- | ---: | ---: |
| 1 | isolated then aggregate | 1221.869 | 414.239 |
| 2 | aggregate then isolated | 1136.583 | 413.875 |
| 3 | isolated then aggregate | 1136.459 | 415.186 |
| 4 | aggregate then isolated | 1251.680 | 410.993 |
| 5 | isolated then aggregate | 1182.536 | 451.606 |
| 6 | aggregate then isolated | 1146.325 | 426.524 |
| Mean | | 1179.242 | 422.071 |

Mean saving: **757.171 ms / 64.21%** for this selection.
The shared worktree remained active; this is a local paired observation, not an
isolated-host benchmark or CI/full-suite speedup claim. The gain is material
without a new framework, so the memory cohort is retained.

### Reproduction and final scope

From packages/safe-bash, using Node 22.23.2:

```sh
TSX_DISABLE_CACHE=1 node --import tsx --test --test-concurrency=1 --test-reporter=tap tests/fs/memory/comparison.test.ts tests/fs/memory/memory-core.test.ts
TSX_DISABLE_CACHE=1 node --import tsx --test --test-concurrency=1 --test-reporter=tap tests/fs/memory/conformance.cases.ts tests/fs/memory/late-authority.cases.ts tests/fs/memory/memory.cases.ts tests/fs/memory/review-regressions.cases.ts tests/fs/memory/rmdir.cases.ts
```

The first command is the final 131/131 direct-memory regression; the second is
the 105-case isolated comparison layout, not a new package discovery route.
Parent owns guarded lint, full integrated gates and Git. No Git, raw lint,
concurrency changes, frozen-checkout access or historical resealing occurred.
All measurement/probe subprocesses have ended. This plan and the memory-only
rename/aggregate patch form one logical improvement; readonly has no patch.

## Exact preserved registration names

### tests/fs/memory/conformance.test.ts (13)

```json
[
  "contract: instances start with isolated, writable directory roots",
  "contract: byte writes and reads preserve arbitrary binary values and isolate buffers",
  "contract: write flags distinguish creation, replacement, and appending",
  "contract: directories support recursive creation and typed, immediate children",
  "contract: rename moves directory trees and preserves file identity",
  "contract: copy is independent, overwrites, and respects exclusivity",
  "contract: removal requires recursion for directories and force only ignores missing paths",
  "contract: symlinks distinguish stat, lstat, readlink, and realpath",
  "contract: permissions and timestamps have usable optional methods",
  "contract: truncation shrinks or zero-fills and defaults to zero",
  "contract: hardlinks preserve shared contents, inode, and link count",
  "contract: streaming round trips bytes and applies half-open read ranges",
  "contract: bounded reads reject overflow and permit exact or empty reads"
]
```

### tests/fs/memory/late-authority.test.ts (17)

```json
[
  "late Memory source authority same precedes content effects",
  "late Memory source authority distinct precedes content effects",
  "late Memory source authority unknown precedes content effects",
  "late Memory source authority error precedes content effects",
  "late Memory source authority invalid precedes content effects",
  "late Memory source authority cancel precedes content effects",
  "late Memory target authority same precedes content effects",
  "late Memory target authority distinct precedes content effects",
  "late Memory target authority unknown precedes content effects",
  "late Memory target authority error precedes content effects",
  "late Memory target authority invalid precedes content effects",
  "late Memory target authority cancel precedes content effects",
  "complete Memory tuples still win over late explicit callbacks",
  "shared Memory authority conflict queries each operand at most once",
  "shared Memory authority cancel queries each operand at most once",
  "shared Memory authority preconstruction-peer queries each operand at most once",
  "late forwarding of the base comparator remains bounded and unknown"
]
```

### tests/fs/memory/memory.test.ts (41)

```json
[
  "relative paths, duplicate separators, dot components, and root-clamped parents",
  "non-directory and missing components are not lexically erased by dot-dot",
  "symlink expansion happens before parent traversal",
  "relative links resolve from their containing directory, including moved directories",
  "dangling links are observable, exclusive writes refuse them, ordinary writes create targets",
  "self loops, mutual loops, and intermediate loops report ELOOP",
  "exactly 40 symlink traversals succeed while 41 fail",
  "directory symlinks retain entry types but support traversals and trailing slash stats",
  "copy follows links but exclusive copy never replaces a dangling link",
  "renaming symlinks moves the link and replacing one does not touch its target",
  "rename rejects descendant destinations even through aliases and leaves state unchanged",
  "rename type mismatches and nonempty destinations preserve both operands",
  "root aliases cannot be removed or renamed",
  "POSIX filenames keep Unicode, backslashes, shell characters, and prototype-like names literal",
  "invalid paths and overlong UTF-8 names fail without side effects",
  "readFile returns byte snapshots and readdir/stat return detached metadata",
  "file modes enforce owner access without host identity or umask",
  "directory permissions distinguish traversal, listing, and parent mutations",
  "failed recursive removal is atomic and does not follow symlinks",
  "hardlink metadata follows overwrite, rename, chmod, truncate, and recursive unlink",
  "hardlinking a symlink preserves link identity and relative target context",
  "rename replacement decrements displaced hardlink counts",
  "timestamps preserve birthtime and explicit values until the relevant operation",
  "directory link counts reflect child directory moves",
  "invalid numeric options fail with EINVAL and preserve content",
  "errno errors include Node-like codes, negative errno, syscall, source and destination",
  "parallel appends and exclusive creators are linearizable",
  "seeded mutation sequences match an independent byte-array model",
  "pre-aborted operations never mutate or consume sources",
  "read streams use stable snapshots and chunks do not alias storage",
  "read stream bounds handle empty ranges, EOF, and invalid options",
  "write streams preserve partial writes on source errors and close producers",
  "stream cancellation closes generators and preserves only accepted chunks",
  "write streams target opened inodes rather than resolving paths after every chunk",
  "invalid byte values are rejected before overwrite and while streaming",
  "destructive operations on slash-suffixed symlinks never mutate their targets",
  "terminal dot components do not remove or move their containing directory",
  "deep recursive removal uses bounded call-stack space",
  "directory rename accepts a new slash-suffixed destination",
  "many-chunk streaming writes preserve byte order and logical size",
  "append capacity does not expose unwritten bytes or alter in-flight read snapshots"
]
```

### tests/fs/memory/review-regressions.test.ts (23)

```json
[
  "review: recursive rm of terminal dot component /dir/. rejects EINVAL and preserves the tree",
  "review: rename from terminal dot component /dir/. rejects EINVAL and preserves the tree",
  "review: rename to terminal dot component /dir/. rejects EINVAL and preserves both operands",
  "review: recursive rm of terminal dot component /dir/./ rejects EINVAL and preserves the tree",
  "review: rename from terminal dot component /dir/./ rejects EINVAL and preserves the tree",
  "review: rename to terminal dot component /dir/./ rejects EINVAL and preserves both operands",
  "review: recursive rm of terminal dot component /dir//.// rejects EINVAL and preserves the tree",
  "review: rename from terminal dot component /dir//.// rejects EINVAL and preserves the tree",
  "review: rename to terminal dot component /dir//.// rejects EINVAL and preserves both operands",
  "review: recursive rm of terminal dot component /dir/child/.. rejects EINVAL and preserves the tree",
  "review: rename from terminal dot component /dir/child/.. rejects EINVAL and preserves the tree",
  "review: rename to terminal dot component /dir/child/.. rejects EINVAL and preserves both operands",
  "review: recursive rm of terminal dot component /dir/child/..// rejects EINVAL and preserves the tree",
  "review: rename from terminal dot component /dir/child/..// rejects EINVAL and preserves the tree",
  "review: rename to terminal dot component /dir/child/..// rejects EINVAL and preserves both operands",
  "review: exact directory rename to missing trailing-slash destination succeeds",
  "review: regular file cannot be renamed to a missing trailing-slash destination",
  "review: existing regular-file destination with trailing slash rejects without replacement",
  "review: mixed symlink and parent traversal precedes trailing-directory rename validation",
  "review: mixed symlink paths with terminal dot and dotdot cannot mutate resolved directories",
  "review: terminal-dot validation does not erase missing or non-directory traversal errors",
  "review: operation paths and absolute or relative symlink targets preserve mixed components",
  "review: ordinary mixed-component mutations resolve their physical parent"
]
```

### tests/fs/memory/rmdir.test.ts (11)

```json
[
  "memory rmdir removes only empty directories without consulting rm or readdir",
  "memory rmdir /missing reports ENOENT with its exact operand",
  "memory rmdir /file reports ENOTDIR with its exact operand",
  "memory rmdir /link reports ENOTDIR with its exact operand",
  "memory rmdir /link/ reports ENOTDIR with its exact operand",
  "memory rmdir /tree reports ENOTEMPTY with its exact operand",
  "memory rmdir / reports EBUSY with its exact operand",
  "memory rmdir /empty/. reports EINVAL with its exact operand",
  "memory rmdir and child creation cannot interleave emptiness check and deletion",
  "memory rmdir preserves directories on cancellation and parent permission denial",
  "memory rm semantics remain unchanged for an empty directory"
]
```
