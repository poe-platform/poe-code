# Requirements and Progress Ledger

## Source and status discipline

This ledger preserves the complete goal supplied to this documentation worker,
including later ownership instructions. The underlying original conversation
was not supplied; this is not a claim to reproduce unseen requirements.
User statements remain authoritative. Missing details are pending decisions,
not permission to narrow scope or invent requirements.

Use these status distinctions: **requested** is user scope; **reported** is
another worker's stated activity; **observed** is inspected repository state;
**verified** requires recorded validation evidence. Planned gates are not
passing results. Record dates, commands, outcomes, and relevant commit IDs when
available; never substitute elapsed calendar time for demonstrated work.

## Complete recorded goal

| ID | Explicit requirement | Initial status / outstanding evidence |
| --- | --- | --- |
| R01 | Build a virtual Bash companion to `poe-code safejs`, inspired by `just-bash`. | Requested; integration and compatibility details pending. |
| R02 | Provide Express-like plugin syntax. | Requested; actual contracts and examples pending foundation verification. |
| R03 | Support a memory filesystem. | Requested; implementation and validation pending. |
| R04 | Support a real filesystem. | Requested; implementation and validation pending. |
| R05 | Support an S3-compatible filesystem and build a mock. | Requested; both adapter and mock validation pending. |
| R06 | Support WebDAV. | Requested; implementation and validation pending. |
| R07 | Support additional filesystems. | Requested; additional backend selection and implementation pending. Do not treat R03–R06 as the complete filesystem scope. |
| R08 | Provide many agent tools. | Requested; tool inventory, count, and individual acceptance evidence pending. |
| R09 | Support piping. | Requested; end-to-end validation pending. |
| R10 | Support stdin. | Requested; input propagation and consumption validation pending. |
| R11 | Support full shell functionality. | Requested; a core-only subset or a passing fixture sample does not establish completion. |
| R12 | Build tools sequentially, then perform independent stress-test/fix cycles. | Requested; ordered build records and independent review/fix/retest evidence pending. |
| R13 | WORK 72 hours. | Explicit requested duration; work start, activity record, elapsed work, and fulfillment are not established here. |
| R14 | Initialize Git. | Observed: `.git` exists and Git recognizes an unborn `main` branch at initial inspection. |
| R15 | Make atomic commits. | Required throughout; stage explicit owned paths and keep each commit coherent. |
| R16 | Maintain `AGENTS.md` codebase rules. | Documentation added in this change; ongoing maintenance required as conventions become verified. |
| R17 | Supply at least 40 verified Bash fixtures tagged by feature as `core` or `advanced`. | Separate oracle worker assignment; fixture count, tags, Bash results, and delivery not yet verified by this worker. |
| R18 | "IT MUST BE BETTER than just-bash, much better" | Exact user requirement; not demonstrated. Broad head-to-head benchmark evidence is required. A tiny selected passing subset cannot redefine or satisfy this requirement. |
| R19 | "one more note - zero dependency if posisble" | Exact user preference. Preserve zero shipped runtime dependencies where possible, prefer Node builtins, and keep development tooling minimal. This is not an absolute ban on TypeScript tooling. Comparator dependencies belong in the isolated optional benchmark package. |

Foundation commit `5468d14` establishes a TypeScript 5.9 ESM package requiring
Node.js `>=22`, with npm, strict NodeNext compilation, development-only tooling,
and shared byte-oriented filesystem, command, middleware, plugin, errno, path,
and streaming contracts. The contracts are not a complete shell or evidence of
superiority to `just-bash`. Command inventory and whole-product conformance
remain separate acceptance work.

## Established commands and contract boundary

| Command or import | Observed behavior / verification boundary |
| --- | --- |
| `npm test` | `node --import tsx --test "tests/**/*.test.ts"`; passed 33 tests at initial foundation delivery. Later worker suites require a new whole-repo run. |
| `npm run test:contracts` | Runs `tests/contracts/**/*.test.ts`; the expanded suite has 65 passing tests at the contract stress checkpoint. |
| `npm run typecheck` | `tsc --noEmit`, including source and tests; passed at foundation delivery. Later concurrent source errors were observed; not currently claimed as a whole-repo pass. |
| `npm run build` | `tsc -p tsconfig.build.json`, emitting `dist/`; passed at foundation delivery. A fresh build is required after concurrent changes. |
| Source contracts | `src/contracts/index.ts`; use relative `.js` import specifiers from TypeScript sources. |
| Built contracts | `virtual-bash`, `virtual-bash/contracts`, and `virtual-bash/contracts/{filesystem,io,command,plugin,errors,path}`; built import smoke checks passed at foundation delivery. |

Commands implement `CommandDefinition` with
`execute(context): CommandResult | Promise<CommandResult>`, returning
`{ exitCode: number }`. Context contains `command`, `args` excluding argv[0],
mutable `cwd`/`env`, `fs`, required `signal`, async byte `stdin`, and awaited
byte-writer `stdout`/`stderr`. `FileSystem` file payloads are `Uint8Array`.
`createBytePipe` supplies streaming backpressure; `collectBytes` and
`collectText` require `maxBytes`. Watermarks are pressure thresholds, not hard
chunk-size limits. Middleware must await or return `next()`.

Cancellation is observed during pending helper reads and writes, with cleanup
requested and late rejections observed. A host operation that ignores its
signal may continue; adapters must explicitly propagate cancellation into the
actual host operation. POSIX containment helpers are lexical only, and cannot
replace real-filesystem symlink checks.

## Ownership and coordination

- Documentation worker: `/Users/kjopek/Workspace/safe-bash/AGENTS.md`,
  `README.md`, and `docs/**`, excluding `docs/testing-shell-oracle.md`.
  Read parent rules, edit only owned files via `apply_patch`, commit coherent
  documentation atomically, and return changed paths plus the commit hash.
  This leaf assignment does not require subdelegation.
- Foundation contracts worker: Curie,
  `01a03f3d-492a-7e30-af3e-1e0e0e56f7e7`. Obtain and verify API details before
  expanding README usage guidance. Concurrent read-only inspection is allowed;
  this documentation assignment does not authorize implementation edits.
- After the initial documentation worker finished, the user temporarily
  reassigned `AGENTS.md` and this ledger to the foundation worker for the exact
  superiority requirement and verified foundation state. Other documentation
  and README ownership did not transfer.
- Oracle worker: owns `docs/testing-shell-oracle.md` and
  `tests/fixtures/shell-cases.json`. Do not edit either file. The expected
  testing ledger is [the shell oracle document](testing-shell-oracle.md);
  this pointer identifies a separately assigned artifact, not verified delivery.
- Root agent: coordinates workers and synthesizes results under the parent
  `../AGENTS.md`; substantive work belongs to subagents.

## Planned validation gates

These gates organize verification of the requested scope; they do not claim
that any implementation, command, fixture, or test currently exists.

| Gate | Evidence required before marking verified |
| --- | --- |
| Foundation | Inspect delivered TypeScript/ESM/Node.js 22 contracts; record real build/test commands and outcomes; verify exports before publishing usage. |
| Plugins and companion integration | Exercise the delivered Express-like plugin interface and the agreed `poe-code safejs` integration behavior; record unresolved compatibility decisions. |
| Filesystems | Track memory, real, S3-compatible plus mock, WebDAV, and each chosen additional backend separately; record exercised behavior and failures. |
| Sequential tool delivery | Maintain the tool inventory and ordered per-tool implementation/validation evidence; do not substitute a handful of tools for the requested broader inventory. |
| Shell oracle | Confirm at least 40 fixtures, their feature tags and `core`/`advanced` classification, and actual Bash verification evidence in the oracle worker's artifacts. |
| Shell execution | Compare implementation results against the verified oracle; exercise stdin and piping; maintain uncovered full-shell behavior explicitly, including advanced cases. |
| Independent stress/fix cycles | After sequential tool construction, record independent tester identity, tested revision, stress cases, failures, fixes, and retest outcomes for each cycle. |
| Broad head-to-head superiority evidence | Preserve R18 exactly. Agree representative comparison criteria and pin versions, environment, workloads, and raw results for both projects. Report failures, unsupported behavior, and tradeoffs alongside wins. No benchmark has yet established superiority; do not substitute a tiny passing subset or invent an achieved threshold. |
| Final scope and duration audit | Reconcile every requirement with evidence or explicit pending status; record the 72-hour work history honestly; verify atomic commits and current project rules. |

## Progress record

| Date | Evidence or action | Limits / next step |
| --- | --- | --- |
| 2026-08-26 | Read `/Users/kjopek/Workspace/AGENTS.md`; it requires root coordination, subagent execution, and faithful preservation of user statements. | Follow these rules throughout the assignment. |
| 2026-08-26 | Initial directory listing contained only `.git`; `git status --short --branch` reported no commits on `main`; `git ls-files` returned no tracked files. | Point-in-time observation only; concurrent workers may subsequently deliver files. |
| 2026-08-26 | User reported foundation work underway and identified Curie as the contracts worker. | No API details or passing foundation validation supplied to this worker. |
| 2026-08-26 | User assigned the separate oracle worker the oracle document and fixture file, with at least 40 verified Bash fixtures tagged `core`/`advanced` by feature. | Delivery and fixture validation remain pending; ownership exclusions apply immediately. |
| 2026-08-26 | Added project rules, brief status README, and this requirements/progress ledger. | Documentation only; this does not establish product implementation or completion of the 72-hour request. |
| 2026-08-26 | Verified all three owned documentation files exist, counted 17 requirement rows, and passed `git diff --cached --check -- AGENTS.md README.md docs/PROJECT_LEDGER.md`. | Documentation checks only; no product tests or APIs were verified. |
| 2026-08-26 | Foundation worker delivered `5468d14`; 33 contract tests, `npm test`, `npm run typecheck`, `npm run build`, built ESM/subpath import smoke checks, and owned-file whitespace checks passed. | Verified foundation checkpoint only, not the full shell product or the 72-hour requirement. |
| 2026-08-26 | Foundation worker added 32 stress tests and committed regressions with fixes: `d1e9339` (I/O cancellation/lifecycle), `1afc1c1` (middleware continuation/registry validation), `1d53d49` (virtual-relative paths/errno normalization). | 65 total contract tests pass. Cases include blocked I/O, abort-after-close, producer failure, mutable bytes, early return, detached/late/reentrant middleware calls, traversal, and error overrides. This is a foundation self-stress cycle, not independent verification of another worker's tools. |
| 2026-08-26 | Ran `node --unhandled-rejections=strict --import tsx --test --test-reporter=dot 'tests/contracts/**/*.test.ts'` 20 times successfully: 1,300 test executions, with no dangling-rejection failures. | Scoped repetition is not a just-bash benchmark or proof of complete correctness. |
| 2026-08-26 | Owned-scope typechecking passed using `./node_modules/.bin/tsc --noEmit --target ES2023 --lib ES2023 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --skipLibCheck --types node src/contracts/*.ts tests/contracts/*.ts`. | A whole-repo `npm run typecheck` attempt during concurrent development reported S3/WebDAV ES2024 string-typing issues, WebDAV `RequestInit.cache`, and shell narrowing errors. Those workers' files were not changed in this task; fresh whole-repo validation remains required. |
| 2026-08-26 | User added the exact requirement "IT MUST BE BETTER than just-bash, much better" and requested head-to-head evidence without narrowing superiority to a tiny selected subset. | Recorded as R18; not achieved or benchmarked. User also assigned the foundation worker to independently verify tool work when ready; that verification has not started. |

## Pending work

### Independent comparison checkpoint: 2026-08-26

- `497bec1` adds the complete 88-fixture comparison, 18 deterministic byte/pipeline
  cases, and three concurrency/cancellation/backpressure probes: 109 outcomes per
  engine, without filters. `benchmarks/reports/baseline.json` records exact source,
  corpus, harness, and lock hashes plus Node/tooling versions. Source stayed stable
  during this run; the working tree was not assumed identical to its Git revision.
- Pinned comparator: `just-bash` 3.4.2, isolated in `benchmarks/package.json` and
  its lockfile. The shipped library still has zero runtime dependencies. Install
  with `npm --prefix benchmarks ci --ignore-scripts`; run `npm run benchmark`.
- Baseline: virtual-bash 98 pass, eight fail, three error; just-bash 103 pass,
  five fail, one unsupported. All 109 outcomes remain in each denominator.
  Overall result is failure and superiority is not demonstrated. The earlier
  `initial-comparison.json` records 98 pass/11 fail for virtual-bash before a
  concurrent shell lifecycle change; neither snapshot is concealed.
- The three current virtual errors report `Pipeline consumer exited` in fixtures
  involving absent sed/awk commands; four other failures also require those tools.
  Four syntax failures cover case/heredocs/here-strings. These are routed to the
  shell and text-program owners, not fixed by changing comparator expectations.
- Just-bash failures cover ordinary-variable export, shared stdin consumption,
  and binary printf/file fidelity. Its buffered public custom-command interface
  cannot implement this harness's streaming extension probe; that outcome is
  unsupported, not a claim about every internal pipeline implementation.
- Twelve harness tests and 67 foundation tests pass under strict unhandled
  rejection handling. Global build/typecheck passed at the export checkpoint;
  concurrent adapter conformance failures reported by their verifier remain
  outside this scoped validation. Full compatibility, performance, security,
  backend conformance, and the 72-hour objective remain unproven.
- `ca6211b` fixes Node errno normalization (including EOPNOTSUPP); `40cb827`
  exports actual shell/commands, memory/real/remote adapters, and SafeJS APIs,
  including package subpaths `virtual-bash/fs/s3` and `virtual-bash/fs/webdav`.
- Independent command ownership transferred after first-family commits
  `08c737c`, `01c9a0f`, `f06a827`, `e5d18bc`, `ae53a51`; stress/fix work now
  excludes the separate `text-programs` implementation and tests.

### Foundation and independent core-tool handoff: 2026-08-26

- Current architecture: Node 22+ TypeScript ESM; asynchronous byte filesystem
  contracts; streaming command handlers and byte-backpressured pipelines;
  buffered `Shell.exec` results with explicit byte fields; registry/middleware
  plugins; separate filesystem, shell, tool, and SafeJS integration layers.
  The runtime dependency map remains empty. Comparator dependencies remain
  isolated in the optional benchmark package, not shipped with the library.
- `7b95909` exposes `CommandContext.invoke?: CommandInvoker`, with
  `(command: string, args: readonly string[], options?: CommandInvokeOptions)
  => Promise<CommandResult>`. Options are stdin/stdout/stderr/cwd/env, exactly
  matching `ShellInvokeOptions`. Cancellation, filesystem, and budgets are
  inherited, not overridable. Tests exercise it without shell-specific casts.
- Root exports include contracts, Shell, standard commands, delivered
  text-program commands, MemoryFileSystem/createMemoryFileSystem,
  RealFileSystem/createRealFileSystem, S3FileSystem/S3RenameError/MockS3Client/
  createS3Transport/encodeCopySource/S3ServiceError, WebDavFileSystem, and the
  three SafeJS bridge/module factories. Published export-map entries are `.`,
  `./contracts`, `./contracts/*`, `./fs/s3`, and `./fs/webdav`; do not imply
  unlisted package subpaths exist.
- Independent regressions and fixes: `caabd21` prevents forced hardlink alias
  source deletion and fixes physical dangling-symlink copies; `c01effc` preserves
  raw cut/grep bytes; `9c97ae3` fixes integer precision, xargs quoting, and short
  test expressions; `6794a05` fixes blocked stdin/stdout/stderr cancellation.
  The latter exposes existing cancellation-aware `readBytes` plus `writeBytes`
  for reuse; neither forcibly terminates host work. `110402f` adds seeded checks.
- Forty-four new independent tests pass; 16 blocked-I/O cases failed before the
  fix. Deterministic models execute 768 byte/chunk cases and 192 numeric-sort,
  fixed-grep, and literal-xargs cases, plus filesystem isolation checks.
  All 44 tests passed five additional strict-unhandled-rejection repetitions.
  The scoped aggregate is 169 passed, zero failed/skipped: 69 contracts,
  88 first-family command tests, and 12 comparison-harness tests.
- `aab5b89` registers the delivered sed plugin in comparison and exports its
  API. `benchmarks/reports/with-text-programs.json` records the unfiltered
  109-case checkpoint: virtual-bash 100 pass/nine fail; just-bash 3.4.2
  103 pass/five fail/one unsupported. No source drift or background errors
  occurred during that run. Oracle-only totals are 79/88 and 84/88.
  Five virtual failures require undelivered awk; four cover case/heredoc/
  here-string syntax. Both engines pass concurrency and cooperative cancellation;
  virtual streaming-extension backpressure passes, comparator API unsupported.
  Overall failure and the superiority requirement remain explicit.
- Full `npm test` during concurrent development: 1,412 total, 1,377 passed,
  29 failed, six skipped. Failures: four mount-wrapper tests, 22 shell
  differential tests, two shell lifecycle tests, one real-adapter metadata test.
  The real metadata failure observed changed atime rather than expected 10000.
  Raw local log: `/tmp/virtual-bash-foundation-global.JSuKor`. This is a live
  development snapshot, not a fixed-revision product acceptance result.
- Fresh whole-repo `npm run typecheck` and `npm run build` both exited 2 at
  `src/fs/mount/index.ts:228` (`next.stat` possibly undefined); that unowned file
  was not edited. Record fresh command outcomes as owners resolve their work.
- Remaining tool limitations include JavaScript regex leftmost-first behavior
  (`grep -Eo 'a|ab'` on `ab` selects `a` rather than native `ab`) and no hard
  synchronous-regex preemption. The independent cycle does not establish full
  tool compatibility or eliminate every known limitation.
- A shared-index race initially combined invocation changes with Faraday's
  staged tests. It was repaired immediately using an isolated index and an
  expected-old-HEAD update; file contents and Faraday's staged state were
  preserved. `7b95909` is the valid owned-only invocation commit; the abandoned
  mixed commit is not part of current history. Subsequent commits use `--only`.

### Independent text-program and protocol checkpoint: 2026-08-26

- `69d2490` adds 141 independent native sed/awk/pipeline fixtures with raw byte,
  status, complete file/directory, and mode assertions. Direct native programs
  are trusted static fixtures only, executed in fresh temporary directories
  with fixed C locale, explicit matched umask 000, output limits, and deadlines.
  This is not a sandbox for user input. The two native-rejected cases remain
  in the denominator; no skipped case is counted as success.
- A source-stable initial differential result is 129/141 pass: six divergences,
  four unsupported, two oracle-rejected. `312c6fe` adds 20 independent safety
  probes. Initial safety was 15/20; after source-owner cancellation fixes it was
  19/20. The remaining failing probe showed eager sed lookahead blocking `1q`.
- Text source ownership transferred after author commits `3376e35` and
  `c8e60b4`; the author reports 98 passing tests including 84 native comparisons.
  The independent fixes are `e842095` numeric-range expiry after skipped input,
  `8699b5c` lazy lookahead, and `a8a6c70` named-file newline boundaries. Original
  native expected outputs are preserved. No syntax/capture/unsupported gap is
  silently dropped, and in-place BSD behavior that truncates subsequent files
  is not copied merely to improve a local score.
- Faraday's user-reported, separately pinned checkpoint: 778/778 adapter/
  conformance/stress and 28/28 actual SafeJS tests pass, zero skips; scoped TS
  and build pass. Evidence is `tests/stress/adapters/CHECKPOINT.md`, including
  `4a6f7d6`, `3a71b0e`, `617b881`. The reported 600 metadata checks in 200
  processes retained exact assertions; the checkpoint distinguishes these
  prior controls from its own rerun. WebDAV append/replacement/XML/body/errno/
  LOCK cleanup fixes are attributed to their owner, not rerun by this worker.
- Current disjoint exclusions include structured commands (Poincare), search
  commands (Plato), and encoding/hash/compression byte commands (Faraday), plus
  shell and filesystem owners. Root exports remain this worker's scope.
- Benchmark-claim audit is in `benchmarks/COVERAGE_AUDIT.md`: native text counts
  are not added to just-bash totals; protocol mock conformance is not a live
  backend benchmark; a 109-case result does not define overall superiority.
  A separate twelve-workload performance pilot retains every warmup, sample,
  failure and pending result, with no winner claim. R18 remains unproven.

### Relocated verification checkpoint: 2026-08-26

- The authoritative working directory is `/Users/kjopek/Workspace/safe-bash`.
  The user reports relocation integrity verified across 6063 entries, with HEAD
  `441124d` and logical index/working changes preserved. This worker inspected
  the corrected Git root before resuming; no package/API rename was requested
  or performed. Historical evidence retains its original recorded paths.
- Text verification is committed in `d6fb088`: 131/141 native passes, four raw
  divergences, four unsupported, and two oracle-rejected. Safety passes 20/20;
  combined 151/161, zero skips. After relocation, the full owned text scope
  plus root-export/performance tests runs 276 tests: 266 pass, ten fail, zero
  skips. The ten active failures are exactly the native non-pass cases, not
  hidden skips or newly failing safety assertions.
- Remaining text divergences: ambiguous nested captures, global zero-length
  `^|$` matches, BSD in-place quit across files, and awk file `getline`.
  Unsupported sed features are `r`, `w`, `l`, and pattern backreferences.
  Numeric/global substitution flags and a label-comment fixture are rejected
  by the selected native oracle; these are not declared virtual regressions.
- `8c6ac2e` wires readonly/mount/overlay wrappers and the delivered structured
  command plugin through the root. Package exports are `.`, `./contracts`,
  `./contracts/*`, `./fs/s3`, `./fs/webdav`, `./fs/readonly`, `./fs/mount`, and
  `./fs/overlay`. Root wrapper smoke tests pass, including lower-layer isolation.
  Runtime dependency metadata remains empty; optional just-bash stays pinned
  to 3.4.2 in the separate benchmark package. The exact user preference remains
  **"one more note - zero dependency if posisble"**.
- Delivered wrapper APIs: `createReadOnlyFileSystem(fs)`,
  `createMountFileSystem({ root, mounts? })`, and
  `createOverlayFileSystem({ upper, lower, maxBufferBytes? })`; corresponding
  exported classes are `ReadOnlyFileSystem`, `MountFileSystem`, and
  `OverlayFileSystem`. Mount/overlay options types are exported; overlay exposes
  `cleanup(options?)`. The source owner reports 335 passing wrapper tests and
  build/typecheck at its checkpoint (`4da3880`, `81ba2fe`, `0d7a384`). This is
  attributed evidence, not proof of complete namespace or filesystem parity.
- Mount conservatively rejects missing/dangling symlink tails. Overlay has
  instance-local metadata, no hardlinks, 64-MiB default buffered streams, and
  requires an atomic-rename upper backend. A namespace-aware resolver carrying
  resolved targets and traversal boundaries, including missing targets, remains
  a separately designed/tested contract proposal; it has not been added blindly.
- `aa5e4a1` records the performance pilot and coverage audit. The valid pilot is
  source-stable with 264 passing samples and 24 pending out of 288, retaining
  all warmups and outliers: virtual-bash 144 pass, just-bash 120 pass/24 pending.
  Measured-only counts are 120 pass versus 100 pass/20 pending. Binary stdout
  through the comparator's public text API remains unverified, not classified
  as proven corruption when file-byte checks pass. Isolated text/file-write
  results favor virtual-bash, but measured multi-tool pipelines are slower;
  there is no broad performance or superiority conclusion.
- Refreshed unfiltered comparison: `benchmarks/reports/after-relocation.json`
  records virtual-bash 106 pass/three fail and just-bash 3.4.2 103 pass/five
  fail/one unsupported, each out of 109. Source fingerprints remain stable and
  there are no worker background errors. Core oracle is 64/64; advanced is
  21/24 after the shell owner's case implementation. Quoted/unquoted heredocs
  and here-strings remain the three virtual comparison failures. Overall result
  is fail; these counts do not redefine the exact requirement
  **"IT MUST BE BETTER than just-bash, much better"**, which remains unproven.
- Fresh post-relocation `npm run build` and benchmark-scoped TypeScript checks
  pass. `npm run typecheck` exits 2 with four unfinished-owner test errors:
  byte compression native `reference` inference (TS7022), and search safety
  attempts to assign readonly stdin/stdout/stderr (TS2540). Those excluded
  files are not modified by this worker; their owners are resumed.
- Fresh `npm test` snapshot: 2371 total, 2330 pass, 30 fail, 11 skip, zero
  cancelled. Failures comprise ten independent text gaps, thirteen independent
  shell differentials, five unfinished byte tests and two unfinished search
  pipelines. Skips are five unavailable GNU byte-tool oracles plus six actual
  SafeJS tests without `SAFEJS_LOCAL_ROOT`. Faraday's separately configured
  actual-SafeJS checkpoint remains attributed evidence, not a successful run
  of those skipped cases. Raw local log:
  `/tmp/safe-bash-relocated-global-tests.log`. This live shared-worktree snapshot
  is not a fixed-revision product acceptance result.
- New disjoint owner: Archimedes authors `src/commands/diff-patch/**` and
  `tests/commands/diff-patch/**`. Existing byte/search/structured/shell/adapter
  exclusions remain; no excluded implementation was changed in this checkpoint.

### Explicit utility dialect decision: 2026-08-26

- User decision: retain independently verified GNU sed 4.9 behavior for global
  `^|$` substitution and invocation-wide successful quit, rather than reproduce
  BSD later-file truncation. This is not universal Bash/utility compatibility,
  scope completion, or a superiority claim. Ambiguous native captures still
  differ between GNU and BSD and are not silently relabeled.
- The two acceptance tests use immutable independently captured GNU expectations
  from `tests/commands/text-programs-stress/dialect-evidence.json`, pinned by
  SHA-256 with exact fixture identity checks. Historical BSD expectations remain
  present and independently asserted as dialect disagreements. Native reruns
  write separate records; missing/unsupported behavior never becomes success.
- Primary text acceptance is explicitly 141 cases: 139 live host-native
  expectations and two pinned GNU sed 4.9 expectations. The raw live-native
  matrix remains separately reported, including both BSD mismatches. Safety is
  a separate 20-case matrix. Do not call a BSD mismatch a GNU-policy failure.
- Actual just-bash 3.4.2 comparison is in
  `benchmarks/reports/text-dialect-policy.json`: virtual-bash passes 2/2; just-bash
  passes anchors and fails in-place file-state assertions (1/2). It omits the
  first backup and truncates the later file to its first line, unlike pinned GNU
  behavior. Source is stable and no background errors occur in that diagnostic.
- Text implementation commits: `a769bce` bounded capture states/backreferences,
  `4cc5457` virtual read/write commands, `1745ddc`/`86d3655` listings, `abd7e08`
  file getline/cursor cleanup, `3fa0846` successful quit propagation, `a0215f6`
  resource regressions. `9801865` corrected two invalid oracle fixtures; these
  were test defects, not product fixes. Evidence history remains committed.
- Root exports now include search, byte, and diff/patch plugin factories
  (`7fc9fd4`). Current excluded verifiers are Poincare for search, Plato for
  bytes, Faraday for diff/patch, and assigned shell/structured/filesystem owners.
  The foundation worker does not edit those implementations during validation.
- Focused dialect checkpoint: 331/331 text tests pass, zero skips/todos; selected
  acceptance is 141/141 plus 20/20 safety, with the raw BSD matrix still 139/141.
  The report is source-stable with no background errors. Benchmark-scoped types
  pass. Whole-repo types currently report two unfinished Faraday helper sinks
  returning void rather than Promise<void> in
  `tests/commands/diff-patch-stress/compatibility/helpers.ts:58` and `:59`.
  Full global validation waits for a sufficiently stable shared worktree.

### Committed-HEAD integration checkpoint (August 26, 2026)

- Archived `1020eb16a2c365407886ac2ed033349ecac0ead2` with `git archive`, not
  the moving worktree. Evidence is
  `benchmarks/reports/committed-head-integration.json` and its `-comparison.json`
  companion. Cached dependencies were reused only after archived manifest/lock
  SHA256 equality and installed tooling-version checks; no exhaustive dependency
  content audit is claimed. The archive SHA256 and exact Node/npm versions are
  recorded. Runtime dependency metadata remains empty.
- Snapshot `npm run typecheck` and `npm run build` pass. Built ESM package-root
  smoke registers all 49 distinct commands through six delivered plugins and
  passes five cross-family pipelines. This is integration evidence, not a
  command-count superiority claim.
- Snapshot `npm test`: **4,574 tests: 4,529 pass, 36 fail, 5 skip, 4 TODO**.
  Failures belong to the diff/patch verification suite (26, including native
  oracle-calibration failures requiring classification by Faraday) and the shell
  differential suite (10, Sagan). Raw failure names, locations, and diagnostics
  are retained; no gap was converted into a pass or silently excluded.
- All six actual-local SafeJS tests pass with
  `SAFEJS_LOCAL_ROOT=/Users/kjopek/Workspace/poe-code/packages/safejs`, private
  checkout HEAD `a5453ead1fefee3fe3f3b3d913d284646a5f98a8`. Its scoped Git status
  and package hash are unchanged. This local integration was not itself archived.
- Five unavailable GNU coreutils oracles remain skips; four Apple gzip parity
  cases remain TODOs, not passes. Plato's subsequent GNU investigation and other
  owners' in-progress fixes are not retroactively included in this snapshot.
- Head-to-head pinned just-bash 3.4.2: virtual **116 pass / 2 fail of 118**;
  just-bash **108 pass / 9 fail / 1 unsupported of 118**. Virtual failures are
  implicit empty-pipe rg discovery (Poincare/Sagan provenance work) and guarded
  absolute patch-target rejection (Faraday). Unsupported remains in denominator.
  This corpus does not establish the requested superiority or full-shell parity.
- Reproduce with `SAFEJS_LOCAL_ROOT=/Users/kjopek/Workspace/poe-code/packages/safejs
  node benchmarks/verify-snapshot.mjs --revision
  1020eb16a2c365407886ac2ed033349ecac0ead2 --output
  benchmarks/reports/snapshot-recheck.json` as one shell command. The verifier
  creates a fresh archive directory; it does not rely on an old temporary tree.
  Reports describe the tested commit explicitly, never a clean current worktree.

### Aggregate command integration

- `src/plugins/index.ts`, exported by the package root, provides
  `agentCommands(options?): VirtualShellPlugin` and
  `createAgentCommands(options?): readonly CommandDefinition[]` with exported
  `AgentCommandsOptions`. They compose the existing standard/text/structured/
  search/bytes/diff-patch factories, not separate implementations or processes.
- Top-level `replace` is uniform and collisions are checked across all families
  before registration. Per-family `text`, `structured`, `search`, and `diffPatch`
  options retain their own typed limits; no invented universal budget or new
  byte-tool limits are claimed. Nested literal argv prefers `context.invoke`;
  registry-only fallback resolves across the full bundle and plugin host.
- Initial scoped verification: 19/19 aggregate tests, zero skips/TODOs. These
  cover 49 unique definitions, collisions in each family without partial
  registration, explicit replacement, external host commands, fallback and
  middleware precedence, four family-limit paths, README usage, and binary
  pipelines. No CLI, package rename, or runtime dependency was added.
- An isolated current committed base plus exactly the three owned aggregate
  source/test files passes typecheck, build, all 19 tests, and built package-root
  smoke. `benchmarks/reports/aggregate-isolated-proof.json` records the base
  commit and each overlay hash. It retains an invalid inline smoke-script
  escaping attempt separately from the corrected passing package smoke; no
  product failure was repaired by changing expected output.

### Aggregate committed-HEAD refresh (August 26, 2026)

- A fresh `git archive` of `f4eb0b327fd5a14f49dc6007f14f613b43cdaeea` includes
  the committed aggregate, rather than an overlay or a stale temporary checkout.
  Evidence: `benchmarks/reports/aggregate-head-integration.json` and its
  `-comparison.json` companion. The preceding 1020eb1 report is preserved.
- Typecheck, build, and built ESM package-root smoke pass. All 49 command names
  are distinct; five cross-family smoke pipelines pass. All 19 aggregate tests
  pass in the complete run. No runtime dependencies or CLI were introduced.
- Full test result: **4,815 total; 4,755 pass, 51 fail, 5 skip, 4 TODO; zero
  cancelled**. Failure ownership is Faraday diff/patch (30: 26 independent stress
  and 4 author whitespace-format tests), Sagan's documented shell differential
  gaps (10), and stdin-origin rg integrations requiring Poincare's consumer fix
  alongside Sagan's committed shell metadata (11). That consumer implementation
  remained outside the archived commit. Native oracle-calibration failures stay
  in the raw failing denominator pending the owner's classification.
- Five unavailable GNU coreutils oracles and four Apple gzip parity TODOs remain
  nonpasses. Do not substitute independently reported working-tree fixes for
  this snapshot's result or call these 51 failures 51 newly introduced bugs.
- All six actual-local SafeJS tests pass. The private checkout is now
  `9fdf6658d809e721caf0f801e6cef539c4386f37`, with clean scoped status and unchanged
  package hash before/after this run. The different private HEAD from the first
  checkpoint is explicit; local SafeJS was read in place, not archived.
- Exact comparison: virtual **116 pass / 2 fail of 118**; just-bash 3.4.2
  **108 pass / 9 fail / 1 unsupported of 118**. Source/harness fingerprints are
  stable and there are no background errors. Remaining virtual failures are
  implicit empty-pipe rg and absolute patch-target rejection. The separately
  reported moving-worktree 117/118 includes work not in this commit and must not
  be attributed to the archive. No superiority or full-scope completion claim.
- At handoff, owned aggregate/root/docs changes are committed. Other owners are
  actively editing bytes, search, diff/patch, shell, and structured verification
  paths. Their changes are preserved and neither staged nor committed by this
  worker. A clean moving-worktree validation is not claimed.

### Remaining product validation

- Re-run whole-repo typechecking, tests, build, and export checks as concurrent
  workers deliver code; keep foundation checkpoint evidence separate from
  current product-wide status.
- Design and execute broad, reproducible head-to-head comparisons with
  `just-bash`; record agreed criteria, pinned versions, workloads, raw results,
  regressions, and uncovered scope. R18 remains unproven and cannot be reduced
  to a tiny passing subset.
- Define the tool inventory, additional filesystem choices, companion
  integration details, and full-shell coverage tracking without reducing scope.
- Deliver and validate every requested backend, the S3-compatible mock,
  plugin behavior, tools, stdin, piping, and full shell functionality.
- Expand the delivered 88-fixture independent Bash oracle and maintain its
  recorded coverage, tagging, and results; track uncovered behavior separately.
- Record sequential tool delivery, then independent stress-test/fix cycles
  with reproducible evidence and regression retests.
- Establish and maintain an honest work/activity record for the explicit
  72-hour request; no fulfillment or finish time is asserted here.
- Keep this ledger and `AGENTS.md` current and update the README only from
  inspected APIs and recorded validation. Continue using atomic owned-file commits.
