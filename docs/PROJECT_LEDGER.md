# Requirements and Progress Ledger

## Safe empty-directory contract and core consumers — August 26, 2026

Contract commit `1dc0652` adds optional `FileSystem.rmdir(path, FsOptions)` without
changing required `rm` or requiring existing adapters to add a method. It has no
recursive/force option. Unsupported methods/backends report `ENOTSUP`; supported
operations preserve children, reject nondirectories and enforce emptiness at
removal, not by listing then recursively deleting. The full contract is in
`src/contracts/filesystem.md`. Poincare owns all backend implementations and
Faraday owns the diff/patch consumer; their separate 34-failure pruning cohort
is not closed by Curie's core tests.

Curie's deterministic core tests reproduce both `rmdir` and `rm -d` deleting a
child inserted after an empty observation and returning zero. The initial
44-test run has 8 passes/36 failures; direct primitive dispatch makes the same
44 pass. An expanded 53-test cohort catches and fixes one additional consumer
issue: `rm -df` swallowing an `ENOENT`-shaped cancellation reason. Final scoped
verification is 226/226 contract/core tests, plus five strict-rejection repeats
of 53/53, with zero skips/TODOs. Tests use an explicit test-only native `rmdir`
adapter, real temporary directories and an actual shell quoted-path case; no
native tool or host filesystem fallback is added to product commands.

Build and scoped TypeScript pass. The first whole-repo typecheck at this
moving-worktree checkpoint reports eight errors in Poincare's in-progress
readonly/real tests; those files are not modified here. Evidence, source hashes,
the historical failure counts and exact locations are in
`tests/commands/empty-directory.evidence.json`. A later typecheck retains those
eight errors and adds an in-progress network `ByteSource` error at
`src/commands/network/curl.ts:246` (Archimedes-owned); it is not fixed here.
The earlier successful build is not a claim that this later source state builds.
This is scoped author evidence,
not a frozen clean-repository or remote-backend certification. Curl remains
Archimedes-owned; metadata remains deferred. The broader goal, superiority and
72-hour requirement are not demonstrated by this increment.

## Curl author assignment — August 26, 2026

The user explicitly requires **"i also need curl"**. This supersedes the just
assigned chmod/stat/mktemp author batch; only read-only metadata investigation
occurred, with no metadata source or tests created. Curie initially owned
`src/commands/network/**`, `tests/commands/network/**`, root exports and root
documentation for an explicitly enabled HTTP(S) curl plugin. The aggregate must
not silently acquire network access. Require manual per-hop authorization,
cross-origin credential stripping, bounded streaming bytes, VFS-only file IO,
honest unsupported options and zero runtime dependencies. Local native-curl and
HTTP(S) oracle tests are test tooling only. A different worker must independently
stress the author result; neither a scaffold nor author tests establish broad
parity, superiority or completion of the full/72-hour objective.

Curl author source commit **6854a6b** delivers the network plugin. Its author
checkpoint is **80/80**, zero failure/skip/TODO, plus strict scoped TypeScript
on Node 22.22.2. It uses local HTTP(S) and native curl 8.7.1, memory/real VFS,
actual shell pipelines, multipart structural comparisons, policy/redirect checks,
timeouts, late-rejection handling, output backpressure, downstream EPIPE and
caller abort. These are author checks, not the separately assigned Archimedes
review. No whole-repo or current moving-worktree clean claim is inferred.

Root/subpath exports expose `networkCommands`/`curlCommands`, definition factories,
`createNodeHttpTransport` and typed host contracts. `agentCommands()` is unchanged;
explicit policy and plugin registration are required. File uploads can change
between replay reads; stdin replay is bounded and fails explicitly when unavailable.
Retries cover selected HTTP response statuses before body publication, not all
network errors. Custom transports must honor signal/dispose; URL policy alone
does not pin DNS. Proxy/connect-only timeouts, TLS bypass and unimplemented flags
are rejected. S3 ABA limits, unpatched SafeJS findings and all broader goals remain
separate and unresolved by this increment.

The root/subpath integration adds one export/registration test: **81/81 scoped
network checks**, zero failures/skips/TODOs. Global `npm run typecheck` and
`npm run build` pass at this moving-worktree checkpoint, as does a built ESM
root/subpath smoke with exact binary output and an unchanged aggregate registry.
A manual moving-worktree `curl STREAM | head -c 5` check returns five bytes/status
zero in about 51 ms and closes the server stream. This is not frozen-revision
proof of the independently owned shell fix or a clean whole-repository test run.

### Accepted handoff and package-only verification

The user accepted the author handoff. **Archimedes now solely owns network
production and author/independent tests**; Curie must not edit those scopes
without coordination. Curie retains root exports/docs and non-overlapping
package/inventory verification. Metadata is deferred until the independent curl
checkpoint. No independent curl pass/fail outcome is inferred yet.

Frozen package audit **b98e239374ccdb53860c88f41b06a4bc977ecc1d** builds and
typechecks. All **15 expanded export entries** import and have their JavaScript
and declaration files in the dry-run package. Static inspection finds zero
third-party or computed imports across **106 emitted JS files / 288 import sites**;
runtime/optional/peer dependency maps are empty, while the three dev dependencies
match the lock root. The dry-run package contains **426 entries**, no tests,
benchmarks or node_modules. No install, network request, full-suite/comparator
rerun, source edit or package API change was performed for this audit. Evidence:
`benchmarks/reports/PACKAGE_AUDIT.json`.

The default registry still contains **49 plugin names**; the optional curl and
SafeJS factories add one name each only when explicitly installed. The inspected
15 kernel names have three default-plugin overlaps: **61 default unique names**,
or **63 with both optional plugins**. This is not a claim that all options or all
names are fully implemented. `COMMAND_COVERAGE.*` records a separate additive
snapshot and preserves the original comparison/coverage observations unchanged.
Root import usage is `README.md`'s Optional Curl Network Command section; the
exact user curl requirement remains in `AGENTS.md`. All broader goals remain
unproven, including S3 same-ETag identity limits and independent SafeJS outcomes.

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

### Post-fix comparison-only checkpoint

- After `55263f6` (rg provenance) and `e685231` (explicit absolute virtual patch
  targets), a fresh archive of `e432c52147a4f355fbae9083cfe1d94a3f78f86d` ran the
  unchanged 118-case comparator. Virtual: **118 pass, zero fail/error/pending/
  timeout/unsupported**. Pinned just-bash 3.4.2: **108 pass, 9 fail, 1 unsupported**.
  Source and harness fingerprints are stable; no background errors occur.
- `benchmarks/reports/post-integration-comparison.json` records the exact commit,
  archive SHA256, manifest hashes, raw byte/status/file-state assertions and
  both engines' nonpasses. The driver returns nonzero because the comparison
  still contains baseline failures; those are not hidden.
- This is comparison only, not another full test/build/typecheck run. The most
  recent complete archived-suite evidence remains f4eb0b3 with 51 failures,
  5 skips and 4 TODOs. The two comparator fixes must not be credited with fixing
  all broader-suite failures. Full-shell parity, broad performance and protocol
  coverage, and the user's superiority requirement remain unproven.

### Individual failure triage and updated complete run

- `benchmarks/reports/FAILURE_TRIAGE.md` enumerates all 51 original failure IDs,
  exact files/test names, owners, later commits, native controls and current
  repro instructions. `failure-triage-index.json` is the machine-readable index;
  raw Apple/GNU/latest focused reports and independent mutation probes remain
  committed beside it. No expected values or other owners' source were edited.
- Original f4eb0b3's 51 classify as **23 verified later source fixes, 1 corrected
  pipeline-format fixture, 11 Apple reference limitations, 6 dialect-specific
  expectations, 4 obsolete duplicate-status assertions, 1 live patch-boundary
  semantic gap, and 5 remaining shell differences**. No race was demonstrated.
  Missing/renamed cases are not passes: seven old labels are retained and mapped
  to their owner's independently documented replacements.
- Focused archived 9d6d292: 660/693 pass with Apple, 669/693 with pinned GNU;
  same-source original labels are 19/51 versus 34/51 passes. Focused archived
  07da999: 684/716 pass, 32 fail; original labels are 24 pass / 20 fail /
  7 renamed. A separate pinned-GNU gate run is 18/28 pass, 10 fail, zero skips
  or TODOs, retaining GNU mixed-format/context flag and boundary-anchoring gaps.
- Priority routes: Faraday's asymmetric non-EOF `-F0` acceptance and mixed GNU
  format/context flag ordering; Sagan's ANSI-C quoting, pinned Bash 3.2 fatal
  parameter exit status and exact diagnostics; root/Sagan decision on whole-
  source prevalidation versus Bash's earlier effects before a substitution error.
  Duplicate conflicts independently show no mutations and unchanged namespace;
  authorized explicit-target header labels do not redirect writes elsewhere.
- Updated complete archived **22fd7e5d46fb00409761196cbaf1ddc27f16f9bf**:
  **6,797 tests: 6,729 pass, 59 fail, 9 skip, 0 TODO, 0 cancelled**. Failures
  route to Faraday (45) and Sagan (14), including newly added test files rather
  than 59 newly introduced bugs. Exact diagnostics are retained in
  `triage-head-integration.json`; no failure is removed from the denominator.
  Build/typecheck, 49-command built-root smoke and six actual-local SafeJS tests
  pass. Private SafeJS HEAD 9fdf6658d809e721caf0f801e6cef539c4386f37 has unchanged
  scoped status/package metadata during the run. Comparator: virtual 118/118;
  just-bash 3.4.2 108 pass / 9 fail / 1 unsupported.
- Later focused checks verify epoch creation (`90b4765`), input-only substitution
  (`7a869af`), pathname classes and bounded unmatched-bracket compilation
  (`50cefdd`). Those do not retroactively make the earlier complete run green.
  Bytes' later 381/381 actual pinned-GNU checkpoint and 373 passes/eight optional
  skips without GNU are attributed owner reports, not this global rerun.
- Zero runtime dependencies remain. New excluded scopes are Plato's optional
  injected `src/commands/safejs/**` and tests, and Poincare's
  `tests/integration/adapter-tools/**`. The requested superiority and full-shell
  goal remain unmet; the small passing comparator is not a substitute.

### Cross-adapter failure triage and core touch fix

- The user's priority is actual remote interoperability before more tools,
  without reducing the full product goal. Earlier 778/778 adapter/conformance
  and 335 wrapper test checkpoints were insufficient evidence of cross-tool
  pluggability. `benchmarks/reports/ADAPTER_MATRIX_TRIAGE.md` records the new
  cohort separately from the original 51 and later 59 whole-suite failures;
  these overlapping observations must not be added as distinct product bugs.
- Five fresh committed archives run unchanged matrix expectations, with exact
  revisions, dependency-manifest/archive hashes and per-test TAP retained:
  6a259ff **58 pass / 21 fail**, b01ceda **61 / 18**, a5d68b9 **66 / 13**,
  1c846a1 **76 / 3**, b8df9e1 **68 / 11**, each of **79**, with zero skips,
  TODOs or cancellations. Reports are `adapter-matrix-*.json`; reproduce with
  `node benchmarks/verify-adapter-matrix.mjs --revision REVISION --output FILE`.
  These are archived-source integration runs, not a moving-worktree or new
  whole-suite/build/typecheck pass.
- Curie's b01ceda fixes ordinary new-file `touch`: creation supplies valid
  filesystem timestamps without requiring optional `utimes`. Existing-file and
  reference-time operations still require timestamp support; missing support
  for `-r` is rejected before creating a partial target. Independent regressions
  failed 3/7 before the fix and pass 7/7 afterward; all 17 focused core tests,
  six original backend touch cases and scoped strict types pass. Two matrix
  improvements belong to this fix; b01ceda's third improvement is Plato's
  earlier 247756d readonly gzip error-precedence fix, not Curie's work.
- Poincare's a5d68b9 restores five WebDAV cases via authorized reads and actual
  pull-based binary streams. Isolated 1c846a1 restores nine S3 cases and the
  mount named-file case: memory, real, S3 and WebDAV each **11/11**, required
  backend subtotal **44/44**, entire matrix still **76/79**. S3 streaming is
  negotiated with the transport, not a claim that every provider supports it.
  That commit changes default rename to conditional copy/delete, explicitly
  non-atomic; `allowNonAtomicRename: false` retains fail-before-I/O policy.
  This is a policy change requiring explicit review, not atomic rename parity.
- Archived b8df9e10df55f84b6736586344f92237b0a51263 additionally contains
  Sagan's 19149d3 Bash-style redirection diagnostics. Its eight extra failures
  are six literal `ENOENT` assertions and two literal `EROFS` assertions, not
  eight demonstrated new backend defects. Readonly tests establish unchanged
  complete namespace/bytes before their diagnostic assertion; missing-input
  redirections still fail, but later checks in those six tests are not reached.
  Poincare/Sagan must reconcile independently specified diagnostics without
  weakening error/status/state assertions. No expectations were edited here.
- Three substantive matrix failures persist at both 1c846a1 and b8df9e1:
  overlay named gzip requires supported streaming reads; cross-mount `cp`
  fails `EXDEV` in both directions (Poincare); raw/slurped jq `split/1` is
  unsupported (Archimedes). Previously blocked cross-mount gzip piping now
  passes; copy support is not implied by that pass. Core/contracts need no
  additional change established by these repros. Poincare now owns all FS
  source and backend/wrapper tests; Curie retains core/contracts ownership.
- S3 uses the supplied mock and WebDAV uses loopback HTTP, not cloud credentials
  or a deployed remote server. Large transfers, provider signing, protocol
  differences, permissions, wrapper compositions and host-operation cancellation
  still need broader evidence. Runtime dependencies remain zero. Neither these
  matrix improvements nor the earlier 118/118 comparator demonstrates the
  requested superiority, full-shell support, or completion of the 72-hour work.
- Faraday's inspected `tests/commands/diff-patch-stress/checkpoint/REPORT.md`
  separately records frozen b92841a: **2,909 pass / 30 fail / 0 skipped** of
  2,939, zero TODO/cancelled. The failures comprise 14 formats, five parser
  native controls, nine compatibility and two standalone fuzz cases. Its
  7,168 passing seeded GNU properties are nested checks, not additional suite
  cases and not a waiver of the 30. Built package 14/14 and comparator 118/118
  versus baseline 108 passes do not imply the broader diff suite passes.
  This is inspected owner evidence, not a new Curie rerun. The user's later
  6e1240e report of 89 independent / 151 safety / 829 GNU author passes and
  825/829 default Apple cases is another scoped checkpoint; Faraday retains
  classification/fixes for context, ranges, fuzz, parent pruning and rejects.

### Independent S3 default-rename policy review

- New owned verification scope is Curie's `tests/stress/s3-policy/**`; all FS
  source fixes remain Poincare's. Commit 63f1842 adds 42 ordinary tests, two
  separately labelled limitation observations, a committed-source archive
  runner and raw evidence. No adapter or existing matrix expectation is edited.
- Exact archived b4033fb96b353bf82025a28aafff6619066967dc is **34 pass / 8 fail**;
  exact archived acef1118fe4e5e0342114ee7d28de5ea02df2327 is **39 pass / 3 fail**.
  Each result repeats in three fresh Node processes, with zero skip/TODO/cancel.
  Both archives use the identical hashed independent test overlay. Intermediate
  worktree evidence includes explicitly identified uncommitted source; it is
  not substituted for either committed archive. Scoped strict types pass.
- Current remaining root cause: rename requires conditional delete but proceeds
  without destination guards when `conditionalCopy` is false/absent. A hook
  creates a concurrent destination immediately before copy; rename overwrites
  that writer, deletes the source and resolves successfully. Two missing/false
  capability preflights and this concurrent-create case remain red. Poincare
  must check adequate publication/deletion capabilities before effects rather
  than silently downgrade. Legitimate default moves and replacement remain
  enabled and tested on capable clients; lack of global atomicity is not itself
  grounds for rejecting all basic rename operations.
- Five earlier failures pass after Poincare's acef111 destination guards: request
  conditions for new/existing destinations, concurrent destination create and
  replace, and a colliding destination child. Source-change guards, paginated
  copy-before-delete ordering, per-position failures, typed partial-state errors,
  lost acknowledgements, cancellation and namespace containment are verified.
  Lists report acknowledged operations only; unknown remote completion cannot
  be inferred from them. This 42-case cohort is separate from earlier matrix
  and full-suite cohorts and is not a new global-clean claim.
- Limitations are measured separately, not added as acceptance passes: a newly
  recreated source with identical bytes/different metadata retains its content
  ETag and can be deleted; a new source child after enumeration remains while
  rename resolves. Thus changed-ETag protection is not incarnation identity,
  and success is not an atomic tree snapshot or proof that source disappeared.
  Preserve these limits and consider stronger provider/coordination designs
  separately, rather than pretending the basic ETag contract promises them.
- Current primary AWS CopyObject, conditional-write and conditional-delete docs
  were read August 26, 2026. Source and destination preconditions differ;
  CopyObject destination conditions are supported in current AWS docs, while
  compatible providers must explicitly negotiate/enforce them. Full-response
  validation is necessary for embedded copy failures. References and complete
  reproduction are in `tests/stress/s3-policy/README.md`; no credentials,
  deployed provider, versioned-bucket or multipart guarantees were tested.
- Root fixture policy: native Bash stderr uses human errors, while typed
  `FsError.code` belongs at the FS API boundary. Poincare is authorized to
  reconcile the eight overstrict matrix code-string assertions with stronger
  boundary checks plus status/error-path/namespace/byte assertions and recorded
  evidence. This is not permission for broad expectation relaxation. Existing
  historical raw matrix failures stay unchanged. Zero runtime deps persist.

### Optional injected SafeJS command root integration

- Author delivery ea0867fb7e62b46ec8993d02af771234349f718f adds the optional
  command plugin. Root integration c2c2651 exports
  `safeJsCommands<Budget>(options?: SafeJsCommandsOptions<Budget>)` and
  `createSafeJsCommands<Budget>(options?: SafeJsCommandsOptions<Budget>)`,
  returning a `VirtualShellPlugin` and readonly command definitions respectively.
  Root also exports structural runtime/budget/run/module/limits types,
  `defaultSafeJsLimits` and `SafeJsCommandLimitError`. Existing `.` package
  export supplies these names; no new dependency or manifest entry is needed.
- `agentCommands()` remains the six-family, 49-command bundle: SafeJS is not
  auto-enabled. Explicit installation adds only `safejs`; execution requires
  host-supplied `run`, `createBudget`, `makeFsModule`, `declareHostOperation`.
  Registering it explicitly without a runtime fails source execution with 127,
  rather than loading a private package or falling back to host evaluation.
  Generic `SafeJsRuntime<Budget>` keeps the host's budget implementation injected.
- Independent root-wiring checks: **24/24 pass**, zero skips/TODO/cancelled,
  comprising 19 existing aggregate tests and five new export/opt-in tests.
  The first attempt had two new verifier-fixture failures from incorrectly
  assuming synchronous Shell plugin setup; the tests now await actual setup
  before registry assertions, with no product-source change to accommodate them.
  These use a contract stub, explicitly not the actual private interpreter.
- Working-tree `npm run typecheck`, `npm run build`, and fresh built-package
  self-import smoke pass. Smoke confirms absent aggregate registration,
  no-runtime status 127, explicit injected execution through a pipeline,
  49 default versus 50 opt-in commands and zero runtime dependency metadata.
  HEAD moved during this integration interval (df5bc45 through 476da9d);
  these are not committed-archive/full-suite results. The two earlier reported
  foreign diff/patch type errors did not reproduce in this check; no foreign
  source was changed by this worker.
- Attribute rather than conflate the user's author checkpoint: 92 actual-local
  SafeJS tests pass, five 56-case lifecycle repetitions; without the local env,
  39 passes and 25 explicit local-oracle skips. Dirac now independently verifies
  the SafeJS command source/tests, including the reported upstream signal plus
  `new Error` defect; Plato's author assignment is closed. The private
  `poe-code` checkout is untouched by this root integration. Author results
  are not independent approval of lifecycle, signal, journaling or replay claims.
- The user separately reports readonly gzip 247756d with readonly matrix 10/10
  and byte suite 390/390, zero skips. This attributed checkpoint does not
  retroactively change old archived diagnostic failures or other suite totals.
  README documents optional runtime injection; AGENTS preserves zero shipped
  runtime deps and Dirac's ownership. The full goal remains unfulfilled.

### Historical S3 policy recheck at 677e03c and ownership

- Renewed review archives current observed HEAD
  **677e03cd21e13e609a5f67d245b0b2f61d635024**, not stale source from the earlier
  root-export report. Three new processes each reproduce **39 pass / 3 fail of
  42**, zero skips/TODO/cancelled. Both limitation observations rerun, and scoped
  strict types pass inside the archive. `tests/stress/s3-policy/677e03c-evidence.json`
  retains exact source/test hashes and transcripts. S3 source hashes match
  acef111; unchanged semantics are verified, not inferred from passing exports.
- **Open at 677e03c, later fixed in d52634b:** default rename with conditional
  deletion but absent/false destination conditional-copy capability writes
  without destination conditions. The independent hook creates a concurrent
  destination; rename overwrites it, deletes source and resolves successfully.
  Three red tests cover absent and false capability preflight plus the actual
  concurrent-create clobber. Require sufficient guards before effects or reject
  an under-capable client. Keep ordinary default rename and stable replacement
  useful on capable clients; `atomicRename` remains false. No blanket rejection
  solely because global atomicity is impossible is requested.
- Current failure-injection controls pass: copy-before-delete ordering, per-key
  copy/delete failures, changed-ETag source protection, typed phase and immutable
  acknowledged progress, cancellation and lost acknowledgements. Same-content
  recreation with different metadata can still be deleted because its ETag is
  unchanged. New children after enumeration survive but rename may resolve with
  a remaining source tree. These are measured identity/snapshot limitations,
  not acceptance passes or evidence that every newly created object is safe.
- Current last-assigned ownership: **Poincare** all FS/backend/wrapper source,
  conformance/stress and adapter-tools matrix; **Curie** shared contracts, core
  commands, root exports/config/docs, aggregate plugins, comparative harnesses
  and independent S3-policy tests (read-only on adapters); **Dirac** independent
  SafeJS command source/test verification; **Faraday** diff/patch source/tests;
  **Sagan** shell source/tests and shell-stress benchmarks; **Archimedes**
  structured command verification. Poincare retains the search assignment.
  Plato is closed; no new bytes-source owner is inferred from that closure.
  Historical names elsewhere are historical checkpoints, not ownership transfers.
- No FS source or other worker's files changed in this review. Source remediation
  is routed to Poincare/root, with reproduction in the policy README. No global
  suite, new CLI or extra tools were run/added. The exact requirement **"IT MUST
  BE BETTER than just-bash, much better"** remains unproven; the broad FS/tools/
  full-shell goal and **72-hour** request are not complete. Zero runtime
  dependencies and the full scope remain intact.

### Exact S3 defect closure and independent SafeJS findings

- **S3 source revision d52634b04aa2c91f52e5bf8c331bc6e9a7b35a95 independently
  verified:** original **42/42** plus bounded **44/44**, five processes per
  suite, zero failure/skip/TODO/cancel. Commit dae02637952bfabfb2c69cca53ec7e2b93b06ca8
  retains exact-revision evidence; the earlier f9b3113 descendant-HEAD check
  remains separate. All four reported S3 source SHA-256 values were matched
  directly against `git show` at the exact source revision, and both test hashes
  match their failing baselines. Scoped strict types pass inside the archive.
  This closes the tested unsafe destination-guard downgrade without disabling
  legitimate copy or conditional-PUT rename/replacement. All 18 same-ETag
  identity-loss observations still reproduce; directory snapshot/global atomicity
  and real-provider guarantees are not solved. Historical failures stay intact.
- SafeJS independent handoff **fa6c095ac8137e853337d78456b0118bdeac48d6** reports
  **124 inclusive checks: 115 pass / 9 fail / 0 skip** against the observed
  unpatched engine, not a clean guest-compatibility gate. Inspected evidence is
  `tests/commands/safejs-stress/README.md`; this update does not rerun that suite.
  The conventional 115 comprise **59 fixture/configuration checks, 45 actual
  engine behavior checks, 10 known-defect characterizations, and one structural
  TypeScript probe**. Therefore 115 is not a count of successful guest behaviors.
  The nine desired-semantics probes remain **0/9 accepted**. No-env inclusive
  results are 59 pass / 65 skip, not equivalent to actual-engine coverage.
- No plugin runtime implementation defect was confirmed by this bounded review;
  that is not proof of absence. Supplied-signal upstream incompatibilities include
  constructors, static methods, own `__proto__` preservation and raw pre-aborted
  execution. Action-triggered abort also produced a separately observed unhandled
  rejection; it is not included in the nine-probe denominator or any pass count.
  Earlier externally changed private-engine snapshots remain separately recorded
  in the source evidence; no clean-private-worktree claim is inferred.
- **Isolated patched validation: pending at this handoff.** Dirac now validates
  proposed upstream fixes only in an isolated `/tmp` copy, with artifacts in
  `docs/upstream-patches/safejs/**` and `tests/safejs-stress/**`; existing
  independent fixtures remain in `tests/commands/safejs-stress/**`. No patched
  counts are supplied or inferred here. Do not relabel unpatched results,
  remove signal forwarding, edit the private `poe-code` checkout, vendor SafeJS,
  or add a private runtime dependency to improve the totals.
- Archimedes now owns independent adapter-diagnostic and in-flight remote
  cancellation verification. Reported diagnostic behavior is 8/8, but the
  append assertion did not cover actual `writeFile` with flag `a`; Poincare owns
  the stronger mutation-killing boundary checks. That observation is not a
  retroactive pass of the old matrix. Existing blocked-pipe cancellation does
  not establish in-flight remote cancellation. No root inventory work changes
  implementation, these owners' files, or any historical cohort denominator.
- Exact superiority requirement, broad full-shell/FS/tool scope and the 72-hour
  request remain unfulfilled. Runtime dependencies stay zero; source-owner
  checkpoints, independently frozen runs and isolated upstream experiments must
  remain distinct.

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
