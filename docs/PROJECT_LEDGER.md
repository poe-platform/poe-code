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

- Documentation worker: `/Users/kjopek/Workspace/virtual-bash/AGENTS.md`,
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

### Remaining validation

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
- Receive the independent Bash oracle artifacts and verify their recorded
  coverage, count, tagging, and results; track uncovered behavior separately.
- Record sequential tool delivery, then independent stress-test/fix cycles
  with reproducible evidence and regression retests.
- Establish and maintain an honest work/activity record for the explicit
  72-hour request; no fulfillment or finish time is asserted here.
- Keep this ledger and `AGENTS.md` current and update the README only from
  inspected APIs and recorded validation. Continue using atomic owned-file commits.
