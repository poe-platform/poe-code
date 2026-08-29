# Requirements and Progress Ledger

Entries retain historical observations, failures and assignments. Later dated
clarifications do not erase earlier evidence; current root assignments override
historical ownership. Durable working rules are in AGENTS.md, not old status text.

## Urgent mount identity dependency — August 26, 2026

Root routes Poincare checkpoint `421ce3f`: three original mount alias
source-truncation failures plus 38 required-red guards need truthful identity
across backend instances and wrappers. Contract commit `fa539de` adds optional
`FileStat.identityScope?: object | symbol`. Complete identity requires the opaque
scope and nonnegative safe-integer device/inode; distinct scopes promise
disjoint storage, not different clients. Wrappers preserve the actual backing
identity, unknown remote identity cannot prove distinctness, and missing-target
copies require actual exclusive creation rather than check-then-truncate.
The native-host scope convention is `Symbol.for("virtual-bash.fs.native")`.
Full semantics and remaining ABA/pathname-race limits are in
`src/contracts/filesystem.md`.

Curie's four new identity type/forwarding tests and the whole contract suite
pass: **82/82**, zero skips/TODOs; scoped TypeScript passes. These tests do not
certify backend identity publication or copy guards. Poincare owns all FS source
remediation; no backend file is edited here. The original 1/4 result and 41
required failures are not closed by a type field. Four prior FS stress
classifications remain unresolved; root reports the revised adapter matrix as
77/79, with remote `rmdir` returning honest `ENOTSUP`, not hidden passes.

The precise contract-owner approval/handoff is also at
`/tmp/safe-bash-mount-identity-contract-approved.txt`; the historical agent ID
was unavailable for messaging, so no direct reply from Poincare is invented.
The output-lifecycle proposal remains unagreed/design-only. Metadata source
author commits (`64b55e4`, `cb707e6`, `7e14b72`, `f846ce4`, `c7f8d59`) are
preserved. Urgent identity work pauses uncommitted metadata root wiring in
`package.json`, `src/index.ts`, `src/plugins/index.ts`,
`tests/plugins/agent-commands.test.ts`, and its new integration test; those paths
are not included in the identity commits. No new metadata or lifecycle breadth
is pursued during this blocker. Dirac's `0c1bfe2` upstream SafeJS proposal remains
**unapproved, 8/9 with caveats**, not an accepted upstream fix. Broader product,
superiority and 72-hour requirements remain unproven.

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

The core fix/evidence commit is `6b89de5`. A subsequent moving-worktree typecheck
at observed HEAD `4a021a9` reports three errors, all in Faraday's new
`tests/commands/diff-patch/pruning-consumer/consumer.acceptance.ts`: line 210
assigns a union-returning wrapper to intersected method signatures; lines 265
and 266 use `Promise.withResolvers` outside the configured ES2023 library.
The earlier eight backend-test and one network-source errors no longer appear;
retain their historical runs rather than replacing them with a clean claim.

Curie's read-only output-lifecycle design review is in
`docs/OUTPUT_LIFECYCLE_REVIEW.md`. Existing lifecycle controls pass 13/13,
zero-read head 1/1, and fresh pinned Bash 3.2/5.3 controls 6/6. No I/O contract or
shell/curl change is made. Recommend explicit owned-transfer opt-in rather than
automatic `pipeBytes` leases; distinguish whole-stage cancellation from an
operation-local guarantee. Sagan's five pending first-read failures remain an
open cohort, including the curl zero-byte corner. Metadata remains deferred.

## Accepted bounded curl finalization — August 26, 2026

Root accepts finalization evidence commit **17285d1**, assertion-only commit
**cbde2fea6a645dbd6395e6b82f1526769e51c1fc**, and stable network source
**aa2da57a5d1be8571f450a27c7b971245c1b7025**. This delivers the requested optional
curl within the documented feature/limit profile; the broader product goal
remains active. Network-tree SHA-256 is
`886d7b03e4b280ab90bb1385f199f363c13349e3fe439fee0777bd274a1499a4`.
Archimedes retains production/test ownership; this documentation update does
not change network source, tests, policy, shell or FS implementations.

Each final cohort ran **once**, with zero failures/skips/TODOs in those cohorts:

| Cohort | Final result |
| --- | --- |
| Author | 81/81 |
| Independent corrected product-v2 | 60/60 (54 native-parity, 6 separate contracts) |
| Supplement | 18/18 (8 parity, 5 security, 5 lifecycle) |
| Frozen retry product | 18/18 native-parity rows |
| Corrected retry lifecycle | 15/15 injected contracts |
| Dirac policy | 22/22 |
| Targeted total | **214/214**, not 214 distinct native-parity cases |
| Actual built-package loopback workflow | **5/5**, separately counted |
| Build | Pass |
| Global typecheck | Exit 2, three unowned FS-test errors |

The captured global typecheck errors are at
`tests/fs/overlay/review-regressions.test.ts:30` (required mapped identity field),
`tests/fs/readonly/metadata.test.ts:45` (required mapped identity field), and
`tests/stress/adapters/s3-truncate-profile.test.ts:50` (incompatible method-name
comparison). They were supplied to owners, not changed or ignored here. These
are the finalization invocation's diagnostics, not a new check of later edits.
The finalization orchestration exits 1 to preserve that global failure.

The runtime fix retains already-published retry bodies on stdout and resets
curl-managed files before retry; header dumps append. The only assertion change
is `recovered:2` to `retryretryrecovered:2`, justified by independently frozen
native body ordering. The retry-count suffix remains a separate product
contract, not a native 8.7.1 feature claim. Prior evidence remains byte-identical:
**80/81 author**, **57/60 original independent**, and **14/15 old lifecycle**.
Earlier repeated acceptance (60/60 x3, supplemental18/18 x3, retry18/18 x3,
lifecycle15/15 x2, plus policy22/22) is a separate cohort, not extra executions
of this final single-run gate. Harness correction `7f7ccfb` and policy sidecar
`7dd5ce6` retain their own histories.

All 294 network samples match the pinned source inventory; HEAD itself was
neither stable nor clean, moving from `09555d0` to `435476d` during capture.
Build/smoke included Curie's **uncommitted metadata root wiring**, producing a
52-default-command working-tree package rather than the committed 49-command
aggregate. Optional curl/SafeJS remain outside both defaults. The build is not
a frozen committed-HEAD snapshot, and the old 49-command inventory/comparator
denominators are not retroactively changed. Preserved pending metadata paths:
`package.json`, `src/index.ts`, `src/plugins/index.ts`,
`tests/plugins/agent-commands.test.ts`, and
`tests/commands/metadata/integration.test.ts`. None enters this docs commit.

Archimedes reports clean owned paths and no remaining owned servers; evidence
records all nine owned process groups absent, without forced termination.
The existing runnable root registration/allowlist example in `README.md` remains
valid. Registration is explicit, HTTP(S) authorization applies per hop/attempt,
I/O is byte-streamed and VFS-only, and runtime dependencies remain zero. No claim
is made for full curl parity, DNS pinning/socket confinement, universal remote
cancellation or an approved pretransport guard. The custom pre-first-byte
`head -n 0` issue remains separately tracked and does not block this bounded curl
delivery. No output-lifecycle API agreement is inferred. SafeJS upstream
`0c1bfe2` remains unapproved 8/9 with caveats. Superiority and 72-hour/full-product
requirements remain unproven.

Evidence: `tests/commands/network-stress/finalization/FINAL_REPORT.md`, its raw
JSON captures, `audit.json` and `seal.json`. Do not overwrite/rerun into that
evidence directory. This update inspects the final handoff; it reruns no tests,
build, server or oracle.

## Metadata author integration — August 26, 2026

The user resumed Curie's deferred chmod/stat/mktemp author assignment after curl
handoff and the identity contract handoff. Source/tool commits are `64b55e4`
(chmod), `cb707e6` (stat), `7e14b72` (mktemp), `f846ce4` (GNU sequential `X`
semantics), and `c7f8d59` (readonly mutation errors versus readable mode fields).
Root integration exports `metadataCommands`/`createMetadataCommands` and their
option/limit types, adds `./commands/metadata`, and extends `agentCommands` to
seven families / 52 unique registered plugin names. Curl and SafeJS remain
explicitly optional. Archive is not yet integrated. No runtime dependency or
private engine dependency is added; development manifest/lock settings agree.

This is author delivery, not independent verification or broad GNU parity.
Tests cover 43 metadata cases (including six actual root/FS/shell integrations)
and 28 aggregate cases: **71/71**, zero failure/skip/TODO. A preceding
contracts/core/metadata/plugins run recorded **301/301** at HEAD `57d9d98`.
Live native chmod evidence has 15 observations: 13 agree and two explicitly
preserve BSD disagreement with the GNU source-derived target. No pinned GNU
chmod executable was tested. Optional stat fields are never fabricated;
timestamps have millisecond resolution. Private mktemp creation requires
declared backend permission support and an existing VFS temporary directory.
No blanket descriptor/parent-path race guarantee or rollback is claimed.

Fresh moving-worktree checks at **4fa4ba9502dac843bd13aa5031d128a3171f597d**
recorded 71/71 tests but global build/typecheck both exited 2: unfinished,
untracked Archimedes archive sources use `String.isWellFormed` at
`src/commands/archive/internal.ts:91`, and `ZlibOptions.highWaterMark` at
`src/commands/archive/stream.ts:9` and `:10` does not typecheck. These are routed
to that owner, not suppressed or fixed in metadata. An earlier moving check
passed typechecking while HEAD advanced from `5233114` to `57d9d98`; the two
observations are not conflated.

An isolated archive of exact base **4fa4ba9502dac843bd13aa5031d128a3171f597d**
plus the five explicitly hashed metadata integration files passes global
typecheck/build and **71/71** scoped tests. All **16** expanded package exports
import and have JS/declaration files. A built-root actual shell/VFS workflow
asserts exit 0, empty stderr, stdout bytes `600:7\n`, and preserved file bytes
`payload`. Manifest/lock declare zero runtime dependencies; TypeScript AST
inspection finds no third-party or computed imports in that source snapshot.
This is an explicitly overlaid author snapshot, not pristine committed-HEAD
evidence or a rerun of the full repository suite. Exact hashes, commands and
remaining limitations: `tests/commands/metadata/AUTHOR_CHECKPOINT.md`.

Metadata is ready for the requested different-agent independent stress/fix
cycle. Archimedes owns new tar source/tests in `commands/archive`; Dirac owns
the separate frozen audit in `benchmarks/reports/current-integration/**` and
later tar verification. Poincare retains all FS identity/backend fixes. Curie
alone integrates root package/aggregate exports after handoffs. No shared
output-lifecycle API agreement is inferred; SafeJS upstream `0c1bfe2` remains
unapproved 8/9 with caveats. Full scope, superiority and 72-hour requirements
remain unproven. Prior 49-name inventories and all historical failures remain
unchanged; no refreshed comparative result is claimed by this integration.

**Committed follow-up:** integration **097f56df1f3933f1dee6473f4effaed0c6500ab2**
was freshly archived without overlays: global typecheck/build and **71/71**
scoped tests pass, as does built-root/subpath factory identity, 52 unique default
names and the exact-byte mktemp/chmod/stat/pipeline workflow. This is bounded
author verification, separate from Dirac's audit. A live-worktree typecheck at
the same HEAD exits 2 on a later unfinished archive error,
`src/commands/archive/format.ts:45` TS1487 (octal escape); it does not invalidate
or turn the committed snapshot into a clean moving-worktree result. Owned
metadata/root integration paths were clean after commit. Earlier archive
diagnostics remain historical, not silently erased. Exact follow-up evidence
is appended to `tests/commands/metadata/AUTHOR_CHECKPOINT.md`.

## Curl author assignment — August 26, 2026 (historical)

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
package/inventory verification. At that checkpoint metadata was deferred until
independent curl verification, and no independent outcome was inferred then.
The accepted finalization is recorded separately above.

Frozen package audit **b98e239374ccdb53860c88f41b06a4bc977ecc1d** builds and
typechecks. All **15 expanded export entries** import and have their JavaScript
and declaration files in the dry-run package. Static inspection finds zero
third-party or computed imports across **106 emitted JS files / 288 import sites**;
runtime/optional/peer dependency maps are empty, while the three dev dependencies
match the lock root. The dry-run package contains **426 entries**, no tests,
benchmarks or node_modules. No install, network request, full-suite/comparator
rerun, source edit or package API change was performed for this audit. Evidence:
`benchmarks/reports/PACKAGE_AUDIT.json`.

That frozen audit's default registry contains **49 plugin names**; the optional curl and
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

### August 27, 2026: copy authority, registry and tar integration

- Ownership: Curie owns contracts/core copy/move and root integration; Poincare
  owns all backend/wrapper implementations and adapter workflow fixtures.
  Faraday owns metadata independent source/tests; Dirac owns archive independent
  source/tests and the separate frozen integration audit. Table-text checkpoint
  `9d1e0fa` remains paused and unexported; no permission to broaden that work is
  inferred. The user requirements, zero-runtime-dependency preference and 72-hour
  request remain active and unproven, not replaced by these narrow gates.
- `37e19b7` fixes core complete scoped-identity comparison and errno-shaped abort
  preservation; `a0a32a7` additionally rechecks current identity before cp-f unlink
  and retries with exclusive creation. `7b04783` adds the EXDEV-only move fallback:
  bounded shared planning budget, copy all content before removal, source
  rechecks, safe nonrecursive cleanup and rmdir for directories. Unknown existing
  identities fail before effects. Unsupported timestamp preservation warns, but
  real errors/cancellation do not become success. No conditional source deletion,
  pathname lease, ABA defense, rollback or full GNU cp-a/mv parity is claimed.
- Exact archive `a0a32a765dc61fa890243484a8a55bd4d8b101e0`, no source overlays:
  build/typecheck pass; core/plugin tests **207/207**, zero skips/TODOs. The unchanged
  compatibility suite is **33/43**: **28/38 positive workflows**, five rejection
  controls, ten failures (eight existing-target remote copies, two existing-target
  remote moves). Preserve original d799cbb 18/38, later frozen59b1269 23/38, and
  preliminary moving32/43 / 27/38 independently; none is rewritten as a pass.
- Decision `5076b32`, after source-owner proposal6df52ef and independent29fe1bf:
  add only `EntryComparison` and optional `FileSystem.compareEntry(path, peer,
  peerPath, options?: FsOptions): Promise<"same" | "distinct" | "unknown">`.
  Exact semantics are in `src/contracts/filesystem.md`: recognized metadata-only
  followed-entry authority, no broad trust flag or fabricated identity, real
  errors/cancel propagated, invalid/conflicting observations EIO, actual future
  mutation-target checks retained. Poincare can implement qualified positive
  remote workflows now; backend closure is not claimed by this type addition.
- The same contract checkpoint explicitly permits S3's d0948bb advisory creation
  modes, regular-file X_OK EACCES and directory X_OK traversal profile. Chmod is
  still unsupported; access does not promise a subsequent GET/PUT authorization.
  Updating the old ENOTSUP-mode/X_OK fixture is an intentional profile delta, not
  a product source repair. Keep the historical red row and all byte, exclusivity,
  denial, cancellation and read-only controls. Poincare owns that fixture work.
- Consumer `f291156` uses comparison authority before EXDEV copy/delete and
  forced-copy unlink, without authorizing unknown final-symlink entries. Focused
  **64/64** and broader core/contracts/plugin **319/319** pass with zero skips.
  Six focused contract checks pass. These are overlapping author cohorts, not
  independent closure of the remote positive38/guard suites. Request a different
  verifier for consumer changes and rerun backend gates when implementations land.
- Registry test-only `7d0fe7b` records an explicit literal52-name expected set for
  the intentional metadata addition. Poincare98498c1 changes adapter preflight to
  22 required capabilities rather than total count. The remaining unchanged
  eight diagnostic plus twelve jq interoperability cases pass **20/20** at the
  committed5076b32-era worktree. This is not a runtime fix or retroactive pass of
  Dirac's dirty57d9d986 audit (9686 pass /164 fail /70 skip;99 preflight failures).
- Tar root integration `4a737f984e5dab09bc73cf23aa1486d341373175` exports
  `archiveCommands/createArchiveCommands/createTarCommand`, options/limits, and
  `virtual-bash/commands/archive`; `agentCommands({archive:{limits}})` includes tar.
  The registry fixture now explicitly names all53 defaults and preserves collision
  preflight/replacement tests. Curl/SafeJS remain optional; zero runtime dependencies.
  Source/author archive tests were not edited. The author128/128 +4built handoff
  remains separate from Dirac's ongoing independent archive review; hardlink/full
  tar parity is not certified by root integration.
- Frozen4a737f9 build passes. Five built-package smoke checks pass: exact53-name
  registry, archive root/subpath identity, ten fixed export entries and declaration
  paths, zero-runtime-dependency/lock consistency, and an actual binary tar pipe
  with VFS source/output bytes preserved. Scoped tests are **476 total:365 pass,
  111 fail, zero skips/TODOs**. Exact triage:106 archive duplicate-registration
  setup failures (boundaries20, core10, lifecycle1, options20, safety55); five
  archive native cases lack the ignored pinned GNU-tar binary in the source-only
  snapshot. Dirac owns fixture repair; no failure is silently skipped or rescored.
- Frozen4a737f9 typecheck fails with one owned exact-optional fixture error plus
  two unowned jq-report implicit-array errors. Owned correction `b291e2a` is
  test-only, with28/28 rerun and strict exact-optional scoped types passing. The
  earlier default strict ad-hoc command missed the exact-optional flag; preserve
  that validation gap. The moving worktree separately showed a jq toWellFormed
  build error and two shell BOM sink-signature errors, routed to owners; those
  dirty-source errors are not part of the frozen build result.
- At the subsequent moving-worktree typecheck on August27 UTC, those earlier
  diagnostics no longer appear; the sole error is unowned
  tests/commands/structured-stress/jq-42-independent-review/evidence.test.ts:26,
  TS18048 on possibly undefined vector.stages. Source owners remain active; this
  is not a clean committed snapshot or a global typecheck pass. The unchanged
  twenty registry-dependent diagnostic/jq cases also pass within frozen4a737f9
  after tar registration, independently of its111 archive-fixture failures.
- Reproduction of the frozen scoped run: git archive4a737f9 into a fresh directory,
  link cached node_modules, run npm run typecheck/build, then node --import tsx
  --test on tests/commands/*.test.ts, tests/contracts/*.test.ts,
  tests/plugins/agent-commands.test.ts, tests/commands/metadata/integration.test.ts,
  tests/integration/adapter-tools-diagnostics/eight-cases.test.ts,
  tests/commands/structured-stress/split-increment/interop.test.ts,
  tests/commands/structured-stress/final-increment/fresh-interop.test.ts and
  tests/commands/archive/**/*.test.ts. Do not silently inject a different native
  oracle into that source-only historical run. No global full-suite pass follows.

### August 27, 2026: resumed table-text author delivery

- Following the contract handoff, Curie resumed the paused9d1e0fa batch without
  duplicating standard cut. Initial source implements paste/comm/join; resumed
  validation reproduced257/257. Three additional Buffer-reuse byte probes then
  failed, showing shared fragments corrupting all three tools. Source fix32513a4
  takes a true Uint8Array snapshot. The original three failing byte outputs and
  unchanged expectations are retained in
  tests/commands/table-text/buffer-ownership-regression.json. Family tests now
  pass260/260 with the pinned native oracle; this is author verification.
- Root integration33347b76def1b2cbbe3f399b3be330d3f40e6a50 exports the table family
  from the root and virtual-bash/commands/table-text. Aggregate tableText limits
  preserve family types; the explicit expected-name registry contains56 defaults.
  Curl/SafeJS stay optional and runtime dependencies remain zero. No unrelated
  source/test changes were staged. Different-agent table stress/fix is pending.
- An isolated git archive of33347b7, cached tooling linked with no source overlays,
  passes global typecheck/build and311/311 scoped tests:260 table,31 aggregate,
  20 unchanged diagnostics/jq interop; zero fail/skip/TODO/cancel. Six built-package
  checks pass, including root/subpath identity, literal56-name registry, binary
  repeated stdin, NUL comm output, real VFS join/cut/paste composition and eleven
  fixed export/declaration entries. This is not a full repository test run.
- The pinned GNU9.7 C-locale corpus remains216 observations with215 matches and
  one documented comm shared-stdin disagreement. All observed binary hashes
  match the frozen native evidence. Matching ordinary stderr wording is not
  asserted; exact stdout, exit status and input bytes are checked, except the
  explicit duplicate-close status disagreement. Passing its characterization
  does not make it a native parity match. No selected-version or broad superiority
  claim follows. No additional oracle installation was needed.
- Evidence and reproduction are in tests/commands/table-text/AUTHOR_HANDOFF.md
  and author-verification.json, including exact source/log hashes and remaining
  flags, locale and quota limits. An ad-hoc scoped TS command initially used
  ES2022 rather than repository ES2023; the corrected scoped command and the
  frozen project-config typecheck pass, without editing shell source.
- The earlier jq compile error no longer appears in the fresh live or frozen
  checks. Other workers continue editing; a committed snapshot pass does not
  certify their later moving state. Core consumer review still needs a distinct
  leaf: Curie cannot independently certify its ownf291156. The explicit review
  handoff is docs/CORE_CONSUMER_REVIEW_HANDOFF.md; design prototype29fe1bf is not
  retrospective production-consumer acceptance. Poincare still owns backend
  positive38/guard retesting. The broad product/72-hour goals remain active.

### August 27, 2026: distinct review and expanded-comparison assignment

- Plato closed the distinct core-consumer review: source0bee8e7 protects cp-P
  source symlink entries through unscoped aliases before destructive unlink and
  returns GNU9.7 status1 for EXDEV alias moves. Frozen independent85/92 becomes
  92/92, with11/11 mutants rejected. Separate test-onlyfe97802 adjusts exactly
  two stale author status assertions while retaining byte/namespace/no-delete
  checks. Original68/70 remains historical; reviewer final author/contracts70/70
  plus independent92/92 and global typecheck/build pass. These are inspected
  reviewer checkpoints, not a new Curie full-suite run. Poincare still owns remote
  authority implementation and positive38/guard reruns; no38/38 claim is made.
- Faraday owns table-text production/tests after the author handoff. Its bounded
  independent ae1d44d checkpoint reports104/104, unchanged author311/311 and
  scoped types; the71 native cases retain70 matches and the documented comm
  disagreement. This does not prove broad native parity or all remote workflows.
- Metadata timestamp fixes2cacd04/0c4709f address the30 semantic differences with
  exact measured native inputs. Original135/141 remains historical with six
  GNU/Node Real chmod differences assigned to Poincare, not waived as passes.
  Dirac continues archive review, Archimedes jq42 fixes, and Sagan invocation-gap
  fixes. Curie does not edit any of those owners' production/tests.
- New tool authoring is paused. Curie's benchmark assignment is bounded to
  150–250 additional oracle/profile-backed recipes, actual default-command and
  kernel coverage, stdin/binary/script/metadata/archive/table workflows and a
  small matched-result performance/memory cohort. Historical118 recipes and
  old19-unshadowed-plugin coverage remain immutable cohorts. Retain unsupported,
  both-engine failures, exact versions, output/effects and coverage gaps; do not
  alter production to win scores or equate backend capability with native parity.
- Primary npm registry queried2026-08-27T01:21:05Z reports latest just-bash3.4.2,
  published2026-08-22T03:28:27Z, matching the official package manifest and the
  installed isolated baseline. No new dependency or duplicate baseline install
  is needed. Pin and preserve release-check metadata with new benchmark evidence;
  main-branch docs are not substituted for installed-release behavior.
- Performance must alternate engine order, repeat matched-output/effect workloads,
  record hashes/runtime/cohost load and avoid claims of hard RSS isolation or
  statistical superiority. A different reviewer will assess benchmark fairness.
  The exact user “much better” requirement and72-hour/full-product goals remain
  unproven; a selected green subset cannot redefine them.

### August 27, 2026: jq checkpoint and native-first expanded corpus

- Fresh routed jq evidence supersedes the earlier pending42-fix note only for
  that specific cohort: source d1f78d4/0278a30 and independent bb1ceabe address
  all42 original full-audit jq failures. The unchanged155+81 cohorts and20
  reviewer vectors record790/790 exact executions, global types and10 built
  checks, with no dependencies added. This is not a Curie whole-product rerun.
- Keep separate remaining jq cohorts:94 legacy probes have45 exact and49
  nonexact observations (six input-grammar and43 diagnostic differences), and22
  historical tests remain red. Archimedes owns native-backed fixes and expectation
  classification; none is waived or counted as a pass. Concurrent FS edits mean
  these results do not certify a single whole-product snapshot.
- The expanded comparator now has224 new recipes, with three declared option
  families for every56 default command,36 kernel/script cases,12 compositions
  and eight local-network cases. Its first228 native observations (224 functional
  plus four performance candidates) all have their declared exit status and were
  captured before product scoring. Recipes and raw native bytes/effects are frozen
  in benchmarks/reports/expanded-20260827/native-first/native.json. Native validity
  is not product acceptance; product comparison and distinct fairness review are
  still pending at this corpus checkpoint.
- Registry recheck2026-08-27T01:39:51Z still reports latest just-bash3.4.2, matching
  the installed isolated baseline; release.json records exact provenance. No
  dependency change/install was needed. Uninstrumented byte controls distinguish
  the baseline public terminal-output metadata boundary from correct internal
  byte pipes/VFS effects; do not infer internal corruption from public encoding.

### August 27, 2026: corrected expanded comparison and routed failures

- Corpus/protocol3462e3e precedes product scoring; jq-ledgerbd2cacb remains the
  frozen production revision bd2cacb3a20403302fd0a49441932d5522793e56. Corrected
  harness0294afb6e690433aed994868e5ed437ecf58ae48 changes no product source.
  The main cohort has224 cases,223 unique input workloads and two exact-script
  overlaps with the historical115 recipes+3 probes. Do not sum the cohorts as
  entirely distinct coverage. Actual execution reaches53/53 unshadowed default
  plugins plus optional curl; true/false/pwd remain kernel-shadowed registrations.
- Corrected exact native comparison: virtual206 pass/18 fail; just-bash3.4.2
  155 pass/69 fail; each denominator224, with zero skipped, pending, timeouts,
  invalid-oracle rows or engine/harness errors. Both pass148; both fail11;
  baseline alone passes seven kernel recipes. Functional groups are commands
  158/168 versus109/168, kernel29/36 versus36/36, composition11/12 versus8/12,
  and optional local-network8/8 versus2/8. No full-product acceptance follows.
- Preserve initial191/224 versus146/224 as non-accepted historical scores:
  macOS canonical temporary-root projection and GNU gunzip/zcat launcher selection
  were oracle defects. Native controls now verify actual decompression bytes,
  replacement effects and canonical paths; unchanged recipes were recaptured.
  Across both runs, all448 product stdout/stderr/status/tree observations and
  source hashes match exactly. The15/9 score changes are oracle corrections,
  not product fixes. ORACLE_CORRECTIONS.md retains causes and raw history.
- Frozen18-failure routing: core/Curie five (realpath relative option, wc padding
  and C-locale character count, env order and nested clean-env propagation);
  bytes/root one (cksum -a); diff-patch/Faraday four (patch -s and downstream
  hash effects); metadata/Faraday one (stat fractional timestamp rendering);
  shell/Sagan seven (type classification, no-shebang/env-shebang scripts,
  source/dot/eval and parameter expansion). Exact paths, scripts, expected and
  actual bytes/effects are in ANALYSIS.json. Formatting/profile differences
  are not automatically data-loss bugs. No production edits were made and later
  concurrent owner fixes have not been certified by this frozen report.
- Inventories distinguish56 plugin registrations,18 kernel names and two script
  entrypoints (union73) from baseline83 registrations/40 kernel names (union120).
  Baseline53 union names absent from this product remain explicit gaps, not free
  passes. Eighteen baseline failed cases target six missing declared names;
  all remain in the denominator. Eleven failures carry exact public byte-boundary
  encoding evidence; internal pipe/VFS controls prevent misattributing those to
  command corruption. Optional SafeJS/Python/JS and backend protocols are separate.
- Seven harness checks plus the native control test pass; instrumentation matches
  plain execution24/24. Three of four performance candidates match both engines;
  the binary candidate remains excluded with its failed output assertion.
  Five alternating-order trials per engine yield30/30 matching observations.
  Median ms: sed51.086 versus113.102, sort38.022 versus5.680 (product slower),
  awk20.899 versus36.840. No combined speed score. Raw sampled memory/maxRSS,
  hashes, Node22.22.2/Darwin25.4.0 and shared-host load are retained; TS source
  under tsx versus installed bundled JS and startup/warmup memory are caveats.
- Evidence: benchmarks/reports/expanded-20260827/ANALYSIS.md and
  corrected-bd2cacb/*.json. Root runtime dependency metadata remains empty and
  no package/lock/dependency or production API changes were needed. There was
  no new global product test/build/typecheck run in this benchmark checkpoint.
  Other owners' moving changes remain untouched. Distinct benchmark fairness
  review, broad required workflows, the72-hour goal and the exact “much better”
  requirement remain open.

### August27,2026 core/bytes, oracle-profile and shell checkpoint

- Curie's author source commits: `b5ec52a` fixes realpath relative rendering and
  GNU wc column width/explicit C character counts; `8bf6f43` adds streaming
  cksum crc/md5/sha1/sha224/sha256/sha384/sha512 algorithm selection. These address
  three of the five frozen core rows and the one bytes row without changing
  benchmark recipes/expected output. Independent source verification is due.
- Two env rows remain distinct: direct assignment output order differs from
  this native profile; nested `env -i A=1 B=2 env -u A` genuinely restores
  cleared variables through shell invocation merge. The proposed additive
  `CommandInvokeOptions.replaceEnv?: boolean` has not been agreed/implemented.
  It would request exact child environment replacement without injecting PWD,
  preserving parent state, stdin metadata, signal and shared budgets. Sagan owns
  runtime integration; no bypass, reversed output or benchmark whitening.
- Sort `f3eb0fe` uses a direct plain-byte comparator and independently owned
  output chunks capped at64KiB after bounded full-input sorting. Online uniq is
  unchanged. `afcea6c` fixes the author's CommandHandler-union test typing error.
  Author sort47/47 and checksum76/76 with pinned GNU9.7 are separate cohorts.
  The new combined focused run passes193/193, zero fail/skip/TODO, on the moving
  worktree at HEAD`d1b10a375a13f031f9f604a64395cd507f21a071`.
- Current global typecheck/build both pass, captured August27,2026
  02:22:49–02:22:54 UTC with that same starting/ending HEAD. Uncommitted changes
  in other owners' FS/archive/metadata source and tests were present. This is
  **not** a committed-snapshot or whole-test-suite result. Package/lock/root
  exports/aggregate were unchanged by Curie; runtime dependencies remain zero.
- Isolated sort evidence `a74456e`, in
  `benchmarks/reports/core-fixes-20260827/sort/report.json`, compares exact
  `b5ec52a` with the same source tree plus only the `f3eb0fe` text.ts blob, and
  installed just-bash3.4.2. All3 eligibility controls and18/18 timed executions
  match stdout/stderr/status/FS. All six order permutations are used. Median ms:
  before37.873, after9.241, baseline5.725: baseline remains faster. Sampled RSS,
  startup/warmup, TS-source versus bundle and cohost-load limitations are retained;
  this is not an overall speed/memory claim. Original slowdown evidence is intact.
- Primary npm registry capture at02:16:39.706 UTC still identifies latest
  just-bash3.4.2, published August22,2026 03:28:27.717 UTC; official repository
  manifest agrees. Exact response/manifest/bundle/lock hashes are in
  `benchmarks/reports/core-fixes-20260827/release.json`. No new install or main
  dependency was needed. The historical3.4.2 baseline remains separately pinned.
- The scratch control commit `2f1bdcb` proves TMPDIR was absent precommand and
  after noop, but GNU patch dry-run created it under the old fixture-local
  scratch configuration. `d1b10a3` aligns all engines to preexisting scratch
  outside `/fixture`; no product workaround or ignored effect paths. The new228
  native observations preserve every recipe/output/status; exactly one final
  namespace loses the empty tmp directory. Nine harness/control tests pass.
  See `benchmarks/reports/expanded-20260827/SCRATCH_PROFILE_DELTA.md`. Historical
  206/224 versus155/224 and all18 original failures remain untouched; no new
  full224 product score is asserted under the scratch-aligned profile.
- `20b889b` adds the distinct frozen baseline-only matrix:53 names, three
  native-backed primary recipes (dot/source/eval), ours0/3 versus baseline3/3;
  the other50 names are unmeasured. This extracts immutable reports, not new
  executions or claims about today's implementations. Separate native-backed
  baseline-led expansion and different-agent fairness review remain outstanding.
- Approved provider-observation rule is documented in `cd8b5c8` and
  `src/contracts/filesystem.md`: faithful forwarding preserves fresh provenance
  and FS/path/stat-to-content binding without method-reference eligibility.
  Remappers/cache gateways omit/replace assertions for actual backing resources;
  no broad trust flag, fictitious disjoint scope or race guarantee. Poincare's
  S3 implementation `91d5926` is observed, not independently accepted here.
  Original31/38 and qualified-mock38/38 stay separate pending Dirac review;
  generic SDK/copied serialized metadata without provenance remains open.
- Fresh shell checkpoint **reported by root**, not independently rerun here:
  source `7e69fe1/6370e7/3aa3a41/abdc741/b02bbe8`; independent `90cbf28`
  unchanged72/72 holdout and132/132 author. Native57 cases retain51/57 GNU5.3
  and49/57 Bash3.2. Expanded-seven `5cfb70a` remains0/7 (type classification,
  headerless fallback, env shebang, source, dot, eval, combined parameter
  expansion); both native profiles7/7. Dirty source/dot/eval author48/48 plus
  productive distinct verification is not accepted. BOM fix16 text failures and
  22 byte checks are separate from63/64 suite with one jq diagnostic assertion.
  Do not infer current kernel36/36; classifier differences need honest semantics,
  not a forced builtin label. Later source/eval commits require their own proof.
- Faraday's patch `-s` and stat formatting fixes are separate production work;
  the scratch-profile correction is only a documented oracle delta. SGID6
  remains a backend/profile decision: command postcheck/rollback is not a safe
  fix for mode/ctime races. All other owners' files and temporary artifacts are
  preserved. The full backend/tool/kernel,72-hour and “much better” goals remain
  active and unproven; no new tool batch or shared lifecycle API was added.

### August27,2026 bounded independent-review handoff

- `benchmarks/reports/core-fixes-20260827/REVIEW_HANDOFF.md` supplies exact
  production commit IDs, source paths and bounded core/bytes/sort review tasks.
  `six-d49d9e5.json` replays the original six rows at committed
  `d49d9e523b99b3464b71b06ffbdfe297e0a3cf0f` with original0294afb harness and
  immutable corrected native expectations:4 pass,2 fail, zero omitted rows.
  Realpath-relative, both wc rows and cksum-algorithm pass; env-order and real
  nested env clearing still fail. No new full224 score is inferred.
- `SAGAN_ENV_HANDOFF.md` records exact expected/actual bytes and the additive
  optional replaceEnv proposal, parent export/local invariants, compatibility,
  actual-shell acceptance and serialized ownership. Curie contract/core env;
  Sagan runtime/types. No implementation or agreement is asserted by the handoff.
  Unit callback success does not close the actual inherited-variable leak.
- Provider-binding documentation remains committed in `cd8b5c8`; backend
  implementation/independent acceptance are distinct. No new feature or broad
  benchmark expansion was made. The50 baseline-only names remain unmeasured.

### August27,2026 approved env contract and pinned ordering follow-up

- Root approved optional replaceEnv: absent/false preserves current invocation
  compatibility; true uses exactly supplied exported env (omitted means empty),
  without inherited-variable/PWD injection or local promotion. Parent values,
  export/local attributes, cwd, middleware, stdin and shared budgets remain
  unaffected. Contract/core consumer commit84fc742 includes focused forwarding
  and legacy actual-shell tests30/30 with typecheck passing. Sagan alone owns
  runtime/types integration; no shell source was changed by Curie.
- Actual pinned native ordering investigation found env.c calls putenv and the
  included gnulib putenv prepends new names, replaces existing slots in place.
  6b81bb3 implements that profile in production, with23 exact native observations
  (5/23 before,23/23 after), covering replacement/unset/duplicate/inherited/NUL/
  numeric names. This is not a portable POSIX/every-GNU-build ordering claim,
  nor a final-output reversal or benchmark normalization. Two old author
  assertions now use documented native behavior; historical expected JSON stays
  unchanged. The combined boundary/order cohort passes80/80, zero skipped/TODO.
- Added actual-shell runtime acceptance remains2/10 pass,8/10 fail before Sagan
  integration, zero skip/TODO. Omitted/false legacy behavior passes; true exact,
  omitted/empty env, explicit PWD, nested clear/unset/prefix and export/local
  isolation are real required failures. Evidence:
  tests/commands/core-env/runtime-before-integration.json. These tests remain
  visible in the main suite; an80/80 subset is not all-green runtime evidence.
  No new six-row replay is claimed until runtime integration is committed;
  historical six-d49d9e5.json4/6 and leak reproduction remain immutable.
- Plato review handoff adds84fc742/6b81bb3 to b5ec52a/f3eb0fe/8bf6f43 (afcea6c
  test typing only). Provider-binding paragraph remains cd8b5c8 and routes to
  Poincare; no new binding API or backend acceptance claim. No new benchmark
  breadth or tool family;50 baseline-only names remain unmeasured.

### August27,2026 provider author first gate and approved SDK resolver option

- Root reports provider first-gate author evidence at eab1d48/1b0cbb9:
  unchanged original38/38 plus5 controls, guards4+49. This is an author-fixed
  original gate, not merely the earlier qualified-mock fixture cohort. Preserve
  historical31/38 and qualified38/38 separately. Dirac's independent review
  remains pending; no all-provider or whole-product acceptance follows.
- Root approved the next minimal S3/WebDAV compareEntry constructor callback
  using the existing FileSystem.compareEntry contract for serialized real
  SDK-like clients. The callback is an explicit truthful host backing-resource
  resolver, retaining composition/alias precedence, error and cancellation
  semantics. No fictional per-client identity or consumer example relying on
  private Mock APIs. Poincare owns options/source/types/docs/tests; the global
  contract is unchanged. Curie will review concrete implementation semantics
  when root routes the handoff, without another design-approval block. Approval
  to implement is not implementation or independent validation evidence.
- Env handoff is already committed:84fc742 contract/core forwarding,6b81bb3
  pinned ordering,ebc7019 required runtime acceptance. Current inspection shows
  Sagan's env replacement tests in progress, not a committed runtime change.
  No replay or all-green assertion is made from that uncommitted work. Historical
  runtime2/10 and six-row4/6 remain; exact six-row replay follows committed
  runtime integration. No other production scope or benchmark breadth added.

### August27,2026 routed patch/stat replay under both committed profiles

- Root reports Faraday patch-s quiet96564fe41/41 plus270 author; stat386196b
  nine-digit human fractions40/40 plus9 epoch, independently reviewed in d506d040.
  Table-text104/104 plus311 with current helper remains separate; shared-stdin
  comm is a real gap Faraday is fixing. The authorized legacy three-digit stat
  assertion update is test-only and not performed by Curie here.
- Curie's separate replay freezes production
  b43c994e1bf94bccef78d1f1ff05228993f19e01 and reuses unchanged committed
  0294afb original andd1b10a3 scratch-aligned harness/gold profiles. Same five
  recipes: original virtual4/5, aligned virtual5/5; installed just-bash3.4.2
  remains0/5 under both, zero skips/capture errors/timeouts. No benchmark or
  expected JSON was edited. Both engines' ten paired product observations are
  identical across profiles; only the native dry-run empty tmp directory effect
  differs. All five virtual streams/status already match native in both profiles.
- Evidence: benchmarks/reports/expanded-20260827/routed-five-profile/b43c994.json
  and README.md, including scripts, bytes/status/FS fields, source/profile hashes
  and reproduction. Historical18 failures/206-of224 and baseline155-of224 are
  preserved; no current full224 score or superiority claim. No dependencies,
  production change, unowned edits or new comparison breadth.
- Env contract/core forwarding84fc742 and ordering6b81bb3 are already handed
  off. Sagan runtime/types remain in-progress in the current worktree, excluded
  from this snapshot. Exact six-row replay still follows committed runtime
  integration, not this unrelated five-row result or stub invoker tests.

### August27,2026 committed env integration and exact six-row closure

- Current authoritative inspection found existing Curie contract/core source
  84fc74259706ee8d7a39680f098aa61d43b0085e and native ordering
  6b81bb356a0b3498160f17a9bf2fb141393c2547 already committed. Sagan runtime
  subsequently committed954f2302e4b2f42f90cb5ffd5670d1936f47390c. Curie made
  no duplicate implementation or shell source edit; verification uses that
  exact committed archive, excluding other owners' dirty FS/archive changes.
- Unchanged original six-row replay at954f230 is6/6, zero failures/omissions,
  using original0294afb harness/environment and immutable corrected native
  expectations. Realpath-relative, wc words-lines, wc Unicode, env-clean,
  env-unset and cksum-algorithm all pass. Nested reproduction now produces
  exactly B=2 plus newline, empty stderr and exit0. Original4/6 replay and
  inherited-variable leak bytes remain preserved in six-d49d9e5.json.
- Frozen runtime acceptance10/10 plus separate boundary/order/Sagan author
  cohort111/111 pass, zero failures/skips/TODO. The historical2/10 is preserved.
  All-source/selected-test typecheck, production build and actual built-package
  root env smoke pass. These are121 focused tests, not the full product suite
  or global all-test typecheck. Complete source/selected-test hashes and raw
  outputs are in benchmarks/reports/core-fixes-20260827/env-integration-954f230.json;
  six-row evidence is six-954f230.json with the unchanged recipe/oracle hashes.
- Exact review handoff is updated for Plato with all source commits and bounded
  regressions; no new source feature, benchmark breadth or expected-output edit.
  This closes only the observed six-row gate. Historical full224/18 failures
  are untouched; no new full comparison total, universal env/kernel support,
  superiority or72-hour completion claim. Fifty baseline-only names remain
  unmeasured. The old transient pending-runtime AGENTS sentence is replaced
  by the durable actual-Shell acceptance rule; its history remains in this ledger.

### August27,2026 root documentation hygiene and export audit

- No product/test source, root export, manifest, dependency or private poe-code
  change. Current root assignments limit this leaf to root docs/integration;
  older ownership snapshots no longer grant command/FS/runtime write authority.
  Workspace orchestrator instructions remain byte-identical. All substantive
  audit/edit work here is performed by the assigned documentation leaf.
- AGENTS is reduced from330 to128 lines of durable rules and exact user
  requirements. Before edits, complete AGENTS and README bytes were archived
  under docs/history/2026-08-27-root-docs/, captured03:53:57.855 UTC at
  42bffab57cbaccbf08648527fc88d85e21a2ee4a. Manifest hashes prove exact copies;
  historical counts, limits, instructions, evidence paths and assignments are
  migrated, not discarded. Archives are historical documents, not active rules.
  README changes are limited to stale status/ownership and explicit S3/SafeJS
  acceptance boundaries; working aggregate/curl examples remain in place.
- Root-supplied acceptance1f2aa30 is corroborated by the independent report:
  f7000b0 fixes all8 old output-charge failures; unchanged accounting cohort is
  17/18, not18/18, because one raw Apple env-order mismatch remains. Original
  budget controls9/9, new independent guards8/8 and seven detected mutants are
  separate evidence. No suite is rerun here. See
  tests/commands/core-regression-stress/OUTPUT_ACCOUNTING_REVIEW.md and
  NORMATIVE_PROFILES.md. Environment order is POSIX-unspecified; the passing
  GNU9.7 capture is Darwin/gnulib, not universal GNU/Linux acceptance.
- Curl remains an implemented explicitly registered optional plugin. Its
  independently reviewed finalization17285d1 retains214 targeted passes across
  author/independent cohorts plus5/5 built-package loopback checks, not214 unique
  native-parity cases or a whole-product pass. README retains exact cohort and
  source references; no network execution is added or enabled by default.
- Structured3758/3758 in the independent seal-final evidence and archive177/177
  in pax-independent/ACCEPTANCE.md are separate scoped suites. The archive gate
  includes explicit fixture-profile/B02 changes and a distinct historical
  control, with a sealed dirty input snapshot; neither total is a fresh full
  committed-product validation. See structured-stress/jq-grammar-doc-closure/
  REPORT.md for the docs-only source-hash distinction. These suites were not rerun.
- Clarification supplied by root: provider positive38/38 includes a WebDAV
  helper semantic change; it is not unchanged all-input proof. Preserve earlier
  author/qualified/independent cohorts and disclose helper changes. The authority
  boundary remains explicit truthful trusted host backing-resource binding,
  never fabricated per-client disjointness. Strict SGID6 remain host-specific
  profile differences, not a mandatory new shared API or unsafe command rollback.
- SafeJS upstream0c1bfe2 remains unapproved with prior caveats. Actual SafeJS
  integration is not closed; isolated patched observations and known-defect
  characterizations must not become accepted guest/replay results. No private
  repository was accessed or modified in this audit.
- The9920 whole-suite result is historical DIRTY57d9d986 evidence:9686 pass,
  164 fail,70 skip; not today's result. Its root build/typecheck and narrower
  comparisons remain tied to that snapshot. No current total is inferred from
  later component passes. See benchmarks/reports/current-integration/HANDOFF.md.
- Incoming real HTTP/SigV4 source now exists in Poincare's src/fs/s3/http, while
  the existing public createS3Transport still wraps caller-supplied minimal
  clients. Isolated42bffab build/export audit exits0: HTTP JS/types are emitted
  and packed, but root and ./fs/s3 lack the factory and ./fs/s3/http rejects with
  ERR_PACKAGE_PATH_NOT_EXPORTED. Zero runtime/optional/peer dependencies; no
  source/manifest/export edit, service contact or other authors' suite run.
  Audit JSON and integration checklist: docs/integration/2026-08-27-s3-http-root-audit.json
  and 2026-08-27-S3_HTTP_EXPORT_REVIEW.md, including full source hashes.
- During this audit14b872c adds independent pinned-service18/18 and14/14 proof
  against42bffab; native guard13/17 remains visible, and explicit form-list
  encoding is a fixture configuration delta. Inspection is not a rerun. The
  harness imports the internal built HTTP module, so public built-package
  consumer proof remains required before presenting a bundled realS3 factory
  as ready. Root wiring is a bounded next integration, not another global
  contract design gate. Broader provider, full-suite, superiority and72-hour
  requirements remain unproven.
- Documentation integrity checks at04:01:44.061 UTC pass: both archives match
  their original hashes, Workspace AGENTS is unchanged, all five exact quoted
  user requirements remain, AGENTS has no transient pass fractions, all eight
  README fenced examples are byte-identical and its local links resolve.
  Root package/lock/export files remain untouched. Details are in
  docs/history/2026-08-27-root-docs/validation.json; these are documentation
  checks, not product-suite passes.

### August 27, 2026 — 04:14 UTC: mechanical S3 HTTP public exports

- Source `3c45ca2e8b2f9c832ab2bfa79ba4aa5140b80c03` adds only root export wiring
  and the `./fs/s3/http` package-map entry. The root and new subpath expose
  `createS3HttpTransport(options: S3HttpTransportOptions): S3Transport` and types
  `S3HttpCredentials`, `S3HttpCredentialProvider`, `S3HttpRequestFactory`,
  `S3HttpTransportOptions`. Existing `./fs/s3` and all Poincare-owned FS source
  remain unchanged by this integration. No API was guessed or renamed.
- Independent mechanical harness `fe46a3c9b1e94744bc1e099f735df05f534117cf`
  repeats against that exact product source, with a clean owned harness scope.
  Capture04:13:59.652–04:14:04.843 UTC: fresh git archive/build, actual pack,
  offline tarball install, plain-Node root/subpath imports and strict public
  TypeScript consumer all pass. Zero runtime/optional/peer dependencies;
  package-lock and development dependency declarations are unchanged.
- Installed package has546 files, no product source/node_modules/tests.
  All135 runtime module resolutions and228 TypeScript inputs are constrained
  to packed output/consumer or explicit dev types/standard libraries. Deliberate
  outside-repository-source and private-subpath imports reject. Three invalid
  TypeScript controls yield expected TS2322/2345/2741 and exit2. Two synthetic
  factory constructions issue zero requests and zero credential-provider calls.
  The wrapper separately passes1/1, zero skips/TODOs; scoped test TS exits0.
- Node22.22.2/npm10.9.7/TS5.9.3, Darwin arm64. Product archive SHA256
  `88561712e95a5231ba9eeb3b02d6b860f2f3976fb4ced63d194d778352f4cc2f`;
  packed SHA256 `dea8d1eaa0bd354b5491f77edd94705d4e1aa73e8d6bec278a1f52de66a5dcce`.
  Full hashes, logs and resolution lists: tests/integration/s3-http-exports/
  evidence-3c45ca2.json; handoff/commands/limits in REPORT.md and README.md there.
- This closes the prior root/subpath packaging gap, not a service or behavior
  gate. Existing native service guards13/17 remain13/17 with four unsupported
  destination-COPY/conditional-DELETE guards. Separate18/18 workflows and14/14
  bounded-copy results disclose their list-encoding fixture change. Complete
  actual-service public-consumer/example remains Poincare-owned; further
  independent behavioral acceptance is not inferred. No service or global suite
  was rerun; no whole-worktree, arbitrary-provider, superiority or72-hour claim.
- README now reflects verified public exports without presenting the factory as
  a completed real-service integration. Durable AGENTS rules remain unchanged;
  old unexported-state audit/evidence is preserved. Concurrent authors' source,
  tests and staging are outside this leaf's commit paths.

## Stream inspection public/default integration — August 27, 2026

- Explicit root authorization releases public/default wiring of accepted source
  `335d2c3705b4892a56e807010cd7ca50145fefce`. Commit `3fb1405` changes only root
  exports, the existing aggregate and the conventional package subpath. Public
  APIs are `streamInspectionCommands`, `createStreamInspectionCommands`,
  `StreamInspectionCommandsOptions` and `StreamInspectionLimits`; aggregate
  configuration is `streamInspection.limits`, with top-level replacement only.
- Both actual registries measure **56→60 unique names**, adding tac, expand,
  fold and strings. Curl/SafeJS remain explicitly optional; runtime dependencies
  and package scripts are unchanged. This is registration/dispatch evidence,
  not a command-count superiority claim or a replay of the historical measured
  50-default/4-optional missing-name inventory.
- Original applicable baseline **124/124** is preserved with its exact test
  text. Wiring against untouched assertions yields **122/124**, only two stale
  list/count failures. Separate expectation-only `81a0ab7` restores **124/124**.
  Author integration `728acd6` adds 21 tests: final **145/145** and scoped strict
  noEmit pass. Its initial **144/145** test-harness reference-identity mistake
  and exact test are preserved, not hidden as a source defect.
- Isolated existing-toolchain build/offline script-disabled pack and extracted
  consumer pass root/subpath runtime/type checks, 12 actual four-command
  dispatches and four aggregate VFS pipelines. Node22.22.2/npm10.9.7/TS5.9.3 on
  Darwin arm64; first package SHA256
  `50c4bb16174543136f6b7708a6e14b98f615c550cc12b99174ededd910c67d9b`.
  That first snapshot includes precisely recorded uncommitted documentation;
  no main dist build or install occurs. Full raw attempts, hashes and commands:
  `tests/integration/stream-inspection-public-author/README.md` and `evidence/`.
- All seven module TypeScript files remain byte-identical to the accepted
  checkpoint; only authorized README availability/numeric-profile statements
  change. Independent original **84/85**, native semantic **85/85**, strict
  **68/85** (17 diagnostic differences), corrected contracts **39/39**, previous
  author99 and fixer82 remain separate unchanged evidence. No native replay,
  GNU/Linux/full diagnostic parity, deployed-provider, superiority, full-product
  or72-hour claim. SGID6/env normative policy is unchanged. Independent frozen
  public-consumer review follows author normal closure, not this author proof.

### Five-command public/default integration — August 27, 2026

- Root public exports `333c7bb` and aggregate/subpaths `b7e9eb5` expose the
  existing `seq`, `nl`, `rev`, `unexpand` and `split` implementations, with
  `streamFormat`/`split` family options and one replacement policy. The default
  aggregate is 65 unique names; the old four stream-inspection commands remain
  separate. `RegexExecutionOptions` from `b1939d7`, cold portable configuration,
  optional curl/SafeJS and zero runtime dependencies are preserved.
- Initial ownership inspection was at `0487969`; the original registry run's
  recorded HEAD is `bf8b554`: **31/31**. Unchanged tests after wiring:
  **29/31**, with exactly two stale registry failures. Test-only `5560a52`
  adds five exact names and migrates 60/61 to 65/66; **31/31** again. Both raw
  original outcomes and source/test hashes are preserved under
  `tests/plugins/stream-five-public/evidence/`.
- The committed-source qualified runner `f544d8f` initially failed snapshot
  preparation because a canonical table fixture was not archived. `dbe3cfd`
  fixes archive coverage without changing product or historical tests. Its
  qualified run passes mandatory metadata/table **318/318**, including all
  **22/22** routed native rows; current default stream replay **18/18** groups
  (82 native inputs on two adapters, 3 workflows per adapter, 16 contract groups);
  registry **31/31**; moved packed consumer **21/21**; strict positive public
  types and seven expected negative type diagnostics. Repeated npm10.9.7
  packs match byte-for-byte; prepare executes even with `--ignore-scripts`
  in an isolated sentinel copy. No root dist emission or dependency installation.
- The new current profile retains the frozen 82 inputs, raw native oracles,
  classifiers and old historical release byte-exact. It changes registry
  presence/count and duplicate plugin/limit configuration only, using actual
  aggregate options. **124/164 strict**, **164/164 stronger diagnostic profile**,
  **40 exact stderr differences across 20 inputs** remain distinct claims.
  GNU9.7-on-Darwin and Apple rev are not GNU/Linux or full native parity.
- `verify:release:qualified` requires explicit existing pinned native assets
  and resolves an immutable source commit (explicit `--source-commit` or
  logged HEAD). Fifteen metadata assets, including the distinct historical
  stat, plus stream references are authenticated before products run. Missing
  and wrong-hash controls on isolated copied assets each return **78**, zero
  product tests, not pass/skip. The portable gate remains unchanged and does
  not replace this qualified job. Detailed exact commands, final source/harness
  pins, follow-up validation and retained helper failures are in the new
  author README/evidence. No full gate, superiority, 72-hour completion or
  independent public acceptance is claimed; a different verifier follows closure.

- Documentation qualification only (August 27, 2026): the qualified stream/native
  profile and scoped 65-command consumer success do not establish overall
  package lifecycle acceptance or release readiness. Per the user's update,
  **five public premature-cleanup failures remain OPEN**, routed to Sagan/Arch
  pending independent closure. Optional `InvocationCleanup` contract `07acb1a4`
  alone does not establish closure; runtime/regex integration remains in progress
  in that update. No rerun or new failure verification is claimed here; the
  author's tested source, hashes, results and historical evidence remain unchanged.

### Current-consumer and archive release wiring (August 27, 2026)

- The mandatory qualified job now adds a committed-candidate archive prerequisite
  and explicit build-first standalone public-consumer phase. Root cold configs,
  canonical test selection, historical consumers/oracles and package dependencies
  are unchanged. Per-path inventory and reproducible commands are in
  `tests/plugins/qualified-current-release/README.md`; frozen evidence is not a
  current pass, and provider-only strict compilation is not provider execution.
- Dirac `aac345a0` retains canonical470/470+485/485 and historical standalone
  omissions11/30. The current inventory separately includes the newly committed
  S3 rmdir consumer; no all-TypeScript-included claim is made. Historical
  selected-gnu strict build-first compilation remains mandatory without running
  its obsolete runtime gate.
- Existing tar pins from `e3c04127` are authenticated and staged only at the
  current candidate's exact hardcoded fixture path. The historical same-e36
  5pass/6fail missing-tool and11/11 configured records are preserved, not wired
  as current proof. Missing/wrong/unset explicit tar input fails setup before
  tests. Fixture uid/gid/groups/umask/ACL and real pinned chmod authority are
  recorded; only a new owned temporary directory may receive group normalization.
- Initial scoped prerequisite controls pass6/6. Exact committed-candidate outer
  execution evidence follows separately. Original author318, independent316/318,
  six historical SGID differences and native124/164 strict plus40 stderr
  differences remain unchanged. Five cleanup blockers remain OPEN pending
  independent closure; this wiring is not full lifecycle/release-ready acceptance.
- Actual outer candidate5456730 exits1: all22 maintained `.mts` inputs strictly
  compile in13 groups;11/12 runtime groups pass, but unchanged WebDAV consumer
  reports12/13 (`mv` to remote: EAGAIN on timestamp postcondition). Root received
  exact fixture/source paths; no unowned correction or waiver is made. Subsequent
  independent phases pass current archive11/11 zero skips, metadata318/318 under
  measured gid20 TMPDIR, stream strict124/164, registry31/31 and packed21/21.
  Three exact-candidate tar negatives exit78 before tests, including valid
  GNU_TAR without explicit fixture setup. Final setup-only0 is not a release pass.
  Both original runner failures, source/test/harness bindings and all raw current
  results are preserved in `tests/plugins/qualified-current-release/REPORT.md`
  and its linked evidence. Archived source/consumer/oracle bytes and rootdist
  remain unchanged during the recorded run; concurrent live work is not certified.

### Exact native-data source separation (August 27, 2026)

- Explicit narrow authorization adds only
  `tests/commands/regex-execution/continuation/artifacts/native` to root
  `tsconfig.json` exclusions and prunes that exact directory in the existing
  package test glob. No compiler option, source, producer, other configuration,
  dependency, root export or immutable fixture changes. The full inspected
  subtree is 22 raw `hit\n` glob payloads across ten producer cases plus 50
  generated tsx JSON caches; no maintained test/helper is present. All six raw
  `.ts` SHA-256 values remain
  `74a02f560cc1d8e023280b5f08a1ee7266e4bec6cea61ca457dc1a758d080fc8`.
- Current author `npm run typecheck` genuinely reproduces six TS2304 native-data
  errors **plus eight new foreign filesystem-inspection sealed-input errors**.
  Two pre-fix captures race concurrent test/source edits and are preserved, not
  represented as frozen matched-source evidence. Stable post-fix working-tree
  capture at HEAD `9f7fed68077a68ef3decb114ace83ad47b75ae14` retains exactly those
  eight foreign errors and no native-data diagnostic. Global status stays failed.
- Current post-fix compiler census is 3,882 files: 176 production source inputs,
  3,533 test-tree inputs and 173 remaining library/type inputs. The actual
  discovery glob selects 540/540 compiler-included files: 533 already tracked
  canonical tests, this author's new control, and six pre-existing ignored
  copied tests elsewhere. That distinction is not a new maintained-test count.
  All 533 tracked canonical tests and explicit main helper/source controls remain
  included; no broader copied-artifact exclusion is authorized.
- Five scoped controls pass with no skips. In isolated copies, six real outside
  undefined-symbol errors still fail compilation, identical payloads inside the
  exact subtree are excluded, and actual current `npm test` runs all five
  canonical/neighbor tests while not selecting two native-data canaries. The
  old script runs seven and fails on both canaries. Production build-config
  `--noEmit` passes; no rootdist output or full product test suite is run.
- Full manifest, per-file source/test/config hashes, raw failed captures,
  current gate output, discovery limits and handoff are in
  `tests/plugins/qualified-current-release-native-data/REPORT.md`.
  Dirac `aac345a0` canonical470/470+485/485 and original standalone omissions11/30
  remain historical; current build-first22inputs/13groups, `966cfac`/`5456730`
  release-helper work and prior source-public65 `b7ae`/`66b079a` remain separate.
  The frozen current-qualified02 WebDAV12/13 failure is not closed, nor are
  Arch's five public-boundary cleanup replays. Sagan's closed runtime work does
  not change these limits; independent verification follows actual author exit.

### Narrow durable-rule maintenance (August 27, 2026)

- Explicit user authorization permits this leaf to edit only root `AGENTS.md`
  and this ledger. Both were staged/unstaged clean before editing; foreign changes
  remain outside the commit. Parent Orchestrator Policy and exact user requirements
  are unchanged; the additions are normative engineering rules, not invented user facts.
- Rules align with `src/contracts/command.md` cooperative `InvocationCleanup`
  admission/shared idempotent finally semantics and `src/contracts/filesystem.md`
  weaker `snapshotRmdir` propagation/refusal and never-descendant semantics. They
  neither promise opaque host work drains nor stronger provider race guarantees.
- Data classification and current-candidate qualification preserve the limits in
  `tests/plugins/qualified-current-release/README.md` and the native-data report
  linked above: tracked consumer inventory is not all-TypeScript-fixture coverage.
  Historical counts and prior failed evidence remain unchanged, not new gate proof.
- Per the user's handoff, runtime `1b133a8`/Sagan build success does not close
  Arch's pending five actual public-boundary replays; independent native-config
  review `14517` is also pending. The current-qualified02 WebDAV failure remains
  open; scoped native-data author controls do not turn global typing green.
- Documentation-only validation checks owned diff whitespace, line count, style
  and local contract alignment; no tests/build, implementation acceptance, full
  release gate, superiority or work-duration completion is asserted.

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

## Time/environment public integration — 2026-08-27T09:37:31.156Z

- Root approved f6406cd/c782363 after Sagan source reviews c9b9626/61c66bc;
  canonical migration f534134 independently reviewed14d42e2. Supported-domain
  source acceptance is not this author's independent public-integration approval.
- Root wiring41298e6 exports timeEnvCommands/createTimeEnvCommands and types at
  root plus ./commands/time-env. AgentCommandsOptions.timeEnv omits replace;
  top-level replacement remains authoritative. Explicit registry65→68 adds
  only date/sleep/printenv; Date.now/UTC defaults, curl/SafeJS optional, zero
  runtime dependencies. Package lock, TS configs, AGENTS5c644ba, qualified
  scripts/data exclusions/consumer inventory remain unchanged.
- Separate count-only commitsba58068/2a8be2e preserve old37/37→29/37 before
  migration and revised40/40 (three added collision controls); adjacent43/47
  before count migration→47/47. Historical65 independent holdout is untouched.
- Exact frozen candidate6ffe4f4f17637e44b55cc0455394513e8d6b94de:306/306 scoped source tests,
  18/18 packed tests twice, two adjacent strict public consumers, build and
  production/public types pass; six invalid type uses and three unavailable-
  runtime/source-access denials detected. No new production fix after wiring.
  Full source/package hashes and all failed harness attempts are preserved in
  tests/plugins/time-env-public. Every attempt removed its exact owned scratch;
  no service suite, private source, dependency install or current full gate.
- DOC-only ISO rationale correction: verified rendered calendar0000–9999, not
  unrestricted abs(ISOyear%100). Native negative-century counterexamples
  -0200-12-31/-0100-12-31 remain; wider bounded epoch conversion is not falsely
  described as parser rejection. No parser/input restriction was added. Bare
  %-N remains virtual-clock policy; padded zeros do not imply measured precision.
  Five ICU differences and semantics-harness11/terminal-env failures remain
  separate, not a wholly green native harness. Root integration note records it.
- Different public integration reviewer required. Known qualified WebDAV12/13
  belongs to its owner's fix/replay; exact release command is handed off in
  tests/plugins/time-env-public/README.md, not run/claimed green here. No overall
  superiority or72-hour completion claim.
- Bounded read-only qualified-release preflight:20 .mts paths unclassified,
  176 tracked/156 inventoried, already present at pre-integrationf534134 and at
  final6ffe4f4. Exact seven time-env/four WebDAV current-like/nine captured
  WebDAV input paths and hashes are in time-env-public/evidence/release-inventory.json.
  No new .mts file was added by this integration. The unchanged release guard
  stops before service execution; owner classification/current coverage is a
  separate follow-up. Do not infer the only remaining release issue is WebDAV.

### Independent time-env public integration and explicit release inventory

- Independent integration-only replay of6ffe4f4: unchanged306 scoped checks,
  packed18/18 twice, two adjacent consumers, six negative types and three
  denials; new independent10/10 integration controls, four negative types and
  three denials. Exact68 defaults and aggregate replacement/option forwarding
  verified. Underlying time-env semantics were authored by this reviewer and
  are not independently re-certified. Bare%-N/ICU/native profiles unchanged.
- Harnessd728c71; source/package hashes match the author (package1a757856).
  First temporary-path permission setup failure retained. No src/private/
  package/lock/config implementation changes or dependency additions.
- Release configuration02704bd/847dfd7 explicitly classifies original20 paths:
  six current, two exact-diagnostic negative, twelve hash-sealed historical.
  Later WebDAV independent.test.mts gets actual current runtime coverage.
  Census177:29 current,2 negative,4 declarations,141 frozen evidence,1 oracle.
  Earlier11/30 omissions remain separate. New paths anywhere in git fail closed;
  no blanket exclusion or assertion migration. Eight inventory guards reject.
- Frozen qualified847dfd7 exits0:17 strict current groups; unchanged WebDAV13/13
  plus20 controls/3mutant kills; metadata318/318+22 native rows; archive11/11;
  stream18/18 (124/164 strict,164 strengthened-profile matches); registry34/34;
  moved pack21/21. Negative diagnostic text/positions remain exact. Actual
  external-service WebDAV/S3 workflows remain compile/import-only here.
- Final repeated package025357bc includes the candidate README. Preserve
  selected-tree02704bd package886abaa1 without README as a distinct earlier
  artifact. Source/candidate-tests/rootdist unchanged; owned scratch cleaned.
  No whole suite rerun, full-gate110 rebaseline, actualservice closure or
  superiority claim. Configuration is newly authored and still needs a
  different verifier. Evidence:tests/integration/qualified-current-release-inventory.
- Sagan's freshSafeJS13/13 surface and18/19 hook audit remains separate from
  packed-public acceptance and this qualified profile; private engine untouched.

### 2026-08-27: independent release-inventory review

- Evidence862fdc54 independently authenticates all20 classifications at847dfd7:
  six current, two exact-diagnostic negatives, twelve sealed historical. Census177
  has no actual omitted row; historical evidence/source identities were checked.
  Unchanged qualified847dfd7 exits0 with the selected results recorded above,
  including actual20 timestamp controls/3mutants. This is not a whole gate.
- Two concrete execution findings remain open: the atomic-extension-independent
  WebDAV consumer is self-contained with injected fetch/binding but its current
  route compiles without running it; an independent moved emitted replay passes.
  Also, removing the canonical timestamp runtime list still returns success with
  zero tests despite nodeTests23. A throwing sentinel is detected when its runtime
  route exists. No config or author-fixture edits were made by this review.
- Independent guard mutations23/27 reject; four survive: coupled reclassification
  plus routing removal, unsupported claimed freeze identity with unchanged
  evidence, an unknown path under the census exclusion prefix, and runtime-list
  omission. This qualifies the earlier broad statement that every new path fails
  closed; no current20 provenance was found false. Configuration authorship is
  trusted, but selected green results do not prove universal routing coverage.
- Full reports, corrected scratch-harness attempts and exact remediation requests:
  tests/integration/qualified-current-release-inventory-independent/README.md.
  Owned scratch removed; no source/config/private checkout or external service
  changes. Whole-product candidate selection remains root coordination.

### 2026-08-27: tree/file public integration author checkpoint

- Root-authorized source wiring1ad428ed adds root/subpath factories, plugins and
  types for tree/file; aggregate options omit nested replace and defaults grow
  from68 to70. Curl/SafeJS remain optional; runtime dependencies remain empty.
  Tree source equals436bda3e and file source equalscd37ce07 byte-for-byte. Their
  separate source acceptance does not independently approve this new wiring.
- Intentional maintained count migration2ae131a9 preserves original75/87 and
  final89/89. An intermediate accidental split hex-byte expectation edit caused
  88/89 and was restored before commit, not accepted as a changed oracle. Old
  sealed68/65 consumer cohorts remain unchanged. See the public migration report.
- Frozen79316dfe (10:36:34.896Z–10:36:44.076Z): production build/no-emit and strict
  moved public types pass;199/199 selected source tests;13/13 new packed tests
  twice; two adjacent current consumers execute; six exact-code invalid type
  uses, four missing-runtime imports and one source-read denial detected.
  Every executed test cohort has zero skips/TODOs. No whole test/type/service
  gate is inferred. Packed source access is denied, not universal host sandboxing.
- Source-tree hashf8b951b9f6802ea6a178ac22dd10b157ec511f7b77ad2a0a038de34a1c51d294;
  706-file packc61274d0fcf14fe4a8dfd3a7b8e1039d51ea914d4eb39617d7a191a5a60202b9.
  Earlier9bd8bd07 passing pack6f985dda remains separate; final README count and
  execution-count guards changed, not product source. Exact evidence/reproduction:
  tests/plugins/filesystem-inspection-public/README.md. All owned scratch cleaned.
- Candidate contains sealed byte7a517cec/7d7dce7c and rmdir3bf672f7 inputs, but
  their full independent holdouts were not rerun by this integration. Canonical
  source/packed81 profiles, stock78/79/configured79/79 historical results and the
  earlier byte corruptions/allocation failures remain distinct. The combined
  whole-gate cohort and different public integration reviewer are requested.
- AGENTS167c32d3 records the durable tested retained-ByteSource copy rule only:
  copy before producer advance/finalization; slice/subarray are views; completed
  awaited transient writes do not require blanket copies. No arbitrary mutation
  safety, new lease API, full native parity, superiority or72-hour completion.

### Independent tree/file public review and release runtime repair

- Different integration reviewer replayed frozen79316dfe: unchanged199/199,
  packed13/13 twice, two adjacent consumers, six negative types/five denials.
  New independent11/11 public controls, six negative types/five denials pass;
  packc61274d0 matches the author. Exact70 defaults, typed option/limit forwarding,
  authoritative replacement, VFS pipelines/refusals and source denial verified.
  No full native parity claim. First own TS2379 wrapper-input error retained;
  only the fixture's optional-override input type changed, not expectations.
- Curie862fdc54 accepted all original20 inventory classifications but found two
  execution holes. Repairc3fbda6279028fd2bde9f6d967970870ff7546aa separates the
  self-contained injected-fetch atomic consumer from real TLS-only inputs and
  adds mandatory canonical-runtime/count validation before/after execution.
  Broad empty-prefix escape removed without changing the177-entry census.
- Frozen repair:18 strict groups/16 emitted programs pass, including unchanged
  atomic runtime (one configured removal, three final PROPFIND observations),
  WebDAV13/13 plus20 controls/3mutant kills, S3 constructor6/6 and exact2+5 type
  diagnostics. New canonical regressions24/24 and scoped strict types pass.
  Actual runner: declared sentinel rejects; omitted runtime rejects before any
  work; missing actual result record rejects. Two guard-removal mutants detected.
- Candidate includes byte7a517cec/7d7dce7c and rmdir3bf672f; src/package/lock/README
  bytes match79316dfe. Uncommitted env-S work excluded. Harness541f2758 is separate
  from evidence. Owned scratch cleaned, foreign staging/scopes untouched.
- Preserve847dfd7 exit0 as incomplete execution coverage, not complete release
  acceptance. No original historical inputs/expectations rewritten, no product
  patch/dependency/private access. Curie must independently verify this repair;
  root decides the next full-gate/comparison run. Evidence and exact reproduction
  are in tests/integration/qualified-current-release-repair and
  tests/plugins/filesystem-inspection-public-independent. No whole gate rerun.

### 2026-08-27 — authenticated type data and build-first workflow

- Source/configuration b9559de5 is Curie's narrow typing repair. Exactly five
  flattened tree captures, causing seven TS2307 and one TS7006, become authenticated
  historical data rather than current compile units. Bytes, provenance, preseal
  and original replay stay unchanged; current contracts, neighboring TypeScript
  and all four current cold-dependent `.ts` consumers remain checked. No broad
  `.ts`/`.mts` or artifact-directory omission. Plato's separate1a18cb18 fixes the
  three file-test TS2749 annotations; no ownership or runtime-fix claim here.
- `typecheck:all` builds once before global source/tests, the existing selected-GNU
  route, three explicit strict source-consumer groups and19 copied-build groups.
  Plain typecheck requires existing built exports and fails with clear exit78
  when absent; it does not claim stale dist is fresh. Runtime consumer execution
  and provider acceptance remain separate from typing.
- Two unchanged later env-S declaration fixtures receive explicit inventory
  routes: positive compile-only and exact single TS2741 negative. Census177→179
  preserves all original classifications; exact negative groups now require1+2+5
  diagnostics. This is not env-S runtime acceptance or a new native profile.
- Final isolated base026e20cf plus ten hashed owned repair overlays matches
  b9559de5; no dirty foreign fixture is copied. One production build/global types
  pass, strict groups3/3+19/19, exact negatives pass;15/15 bounded controls plus
  unchanged24/24 runtime-coverage controls. Failed-build/stale-use, missing-current
  consumer, unknown tracked input, source-error, neighbor-error, broad-exclusion,
  changed-capture and source-resolution controls reject. Earlier v1/v2 and all33
  raw captures remain sealed. No private checkout, dependency or product change.
- Independent execution-repair acceptance had already been recorded in7f7764b5
  for c3fbda62; c4783b71 only corrects a terminal-LF manifest representation.
  This supersedes the earlier pending-review status, not847dfd7's historically
  incomplete coverage. Original b49416520/307/13 is still unqualified; its30→11
  and954's35→11 typing cohorts and all ten remaining failures remain in evidence.
- See tests/integration/typecheck-workflow-repair/README.md and its read-only
  verifier. A different reviewer must accept this new workflow. The whole-gate
  launcher still requires a reviewed new candidate/policy and complete native
  staging; no broad suite was rerun, old seal rewritten, or product superiority
  or72-hour completion asserted.

### 2026-08-27 — sealed comparison references and evidence rules

- Seal8670ebe8 contains the independently reviewed comparison of source
  e33974b8c643077453227a9679d8ceca8367998c against pinned just-bash3.4.2.
  The seal commit is not the measured source revision or a whole-product gate.
  Earlier registry captures and comparison reports remain historical; this update
  makes no latest-release claim or retroactive change to their results.
- Original oracle-predicate matches: virtual222/224 (2 failures), baseline155/224
  (69 failures). Aligned matches: virtual223/224 (1 failure), baseline155/224
  (69 failures). These overlapping profiles remain separate, not an additive score.
- Breadth uses declared-intent predicates rather than native goldens. Target
  operational credit is virtual13/54 versus baseline47/54; controls7/7 versus6/7.
  Seven diagnostics per engine remain unscored. Baseline50 raw target matches
  do not become50 operational passes: the report preserves documentation/no-op/
  stub/partial classifications and the actual forced-cleanup lifecycle failure.
  There is no superiority, speed, release-green or broad-goal completion claim.
- Authoritative references:
  benchmarks/reports/current-comparison-20260827/measurement-review/FINAL_REVIEW.md
  and FINAL_REVIEW_RECEIPT.json; the sealed raw archive and earlier failed review
  attempts remain intact. README now links these final qualified tables, not the
  earlier producer handoff's pending-review status. No old report was rewritten.
- The public/default aggregate remains70 unique commands, with curl and SafeJS
  explicitly optional. The live grep-aliases and column work is not integrated
  into that aggregate or injected into frozen8670. Root manifests/exports are
  unchanged by this documentation update.
- AGENTS adds only missing durable rules: canonical tests do not rewrite committed
  evidence; explicit captures use unique isolated output; authorized committed
  archives bind immutable candidate inputs independently of unrelated live edits,
  while strict-live mode continues rejecting dirty inputs. No timeline metrics
  or transient ownership state is added to AGENTS.

### 2026-08-27 14:46 UTC — frozen8670 gate stopped on evidence mutation

- Actual candidate8670ebe8f0d39966c2de2638780437398e5f8490, not moving HEAD.
  Independent archive admission58130545 preceded execution. A redundant native
  tar publisher blocked attempt v3 before tests; external harness fixf6e07510
  and9 author controls preserve that failure separately in6fce94f8.
- Attempt v4 authenticated49 native assets, exact560 canonical paths and the
  candidate220-input cleanup envelope; it used concurrency2. Cold typecheck
  returned documented prerequisite78; typecheck:all built once and passed.
- Canonical raw footer:17,454 pass,12 fail,0 skipped/TODO/cancelled. Then tracked
  split captures gnu-errors-latest.json and gnu9.7-darwin-latest.json differed.
  The integrity guard stopped later runtime-consumer, separate contract/type
  and outer moved-package phases. This is NOT immutable whole-gate acceptance;
  no packed70-name smoke or current-release result is inferred.
- Exact12: four TypeScript-importing files fail at loader startup; one known
  pre-fix rg iterator-close failure; one native strings executable-path capture
  mismatch; one old exact-tsconfig assertion; five known custom first-read
  requirements. No source fix, fixture waiver, rescore or rerun was applied.
  Later rg repair, aliases/column, shebang and sort-cache work remain excluded.
- Actual regular-copy SafeJS availability passed; private state and264 source
  files stayed unchanged. Two actual-engine test files nevertheless failed at
  startup, so0 skips is not their acceptance. Nineteen named characterizations
  remain included in the raw footer and separately identified, not feature wins.
- Evidenced98b8321 preserves806 raw output files and exact failure routing in
  tests/integration/full-gate-20260827/combined-8670ebe8/attempt-v4/README.md.
  Capture verification authenticates all806 files and reconciles the footer.
  Observed owned processes/scratch are cleaned; foreign live changes preserved.
  Historical b49416,520/307/13 and all comparative profiles remain separate.

### 2026-08-27 17:23 UTC — aliases/column public integration author checkpoint

- Root accepted shared-input fixture18c02655, alias settlement fixture3ceac6f3
  (77/77+5/5; old80/82 retained) and column final491a98b9/padding reviews before
  authorizing egrep,fgrep,column public/default wiring70→73. Sourcecb940da6
  exports existing factories/types at root and explicit commands/grep-aliases
  and commands/column subpaths. AgentCommandsOptions.regex reaches standard
  grep and both aliases; column omits nested replace. Top-level replace remains
  authoritative. Standalone aliases need no separately registered grep.
- Executed isolated commit3dc0ac26d681badfd4db6319f2630274095c3100 is accepted
  base0123c83d plus14 enumerated root/fixture/harness paths, made with a temporary
  private index and commit-tree; it is not moving HEAD. Shared HEAD already
  contained new tree authorf1a90436; live regex/expr and untracked du also existed.
  Those sources were excluded, not silently certified. Root source remains clean.
- Author evidence: build/production types pass;63/63 scoped registry/stream tests;
  strict moved-package root/subpath types;6 exact negative types;17/17 packed
  cases twice;2 maintained consumer runtimes;4 missing-module plus2 source-denial
  controls. All738 packed files and238 archived inputs authenticate/retain bytes.
  Tarball SHA994dca37308937059b1adacade54f24bd8227589ad65c46c7f4fb661c702c9d5;
  package.json SHA691426f4934c471d2a76d49675f3fc19f3ddc47c8aa63cc38671d899a09c4535.
- Earlier author attempts remain failed:12/16 (wrong synchronous setup boundary),
  expanded61/63 (incomplete current registry migration),14/17 (input-object versus
  stored-definition identity). Only author fixtures changed; productioncb940da6
  is unchanged. Historical70-name and whole8670 unqualified17454/12/0 results
  are not rescored. Report tests/plugins/aliases-column-public-author/REPORT.md.
- Independent PUBLIC integration review is pending Meitner's frozen dbceec2b;
  this is scoped author completion, not self-approval or a whole gate. Curl and
  SafeJS remain opt-in, expr/du are not defaults, runtime dependencies remain zero.
  Existing AGENTS durable rules already cover this work; no transient counts added.

### 2026-08-27 — root-relayed later foundation/feature scope, not8670 evidence

- Allocation metadata corea3febbee8/wrappers8991abc3 independently93355f81/8f19a9d5:
  optional readonly FileStat.allocatedBytes is provider-reported nonnegative safe
  integer, zero known/absence unknown, not physical-unique storage or RSS. Real
  projects validated blocks*512 on Darwin/Linux code paths; Linux execution is
  unverified. Wrappers preserve it; Memory/S3/DAV remain unknown. No command change
  follows; du is separately being authored, not default-registered here.
- Curl count capsbb7f5972 independently32debb6a allow0/-0 only for maxRedirects
  and maxRetries (defaults10/5). Initial authorized request perURL remains usable;
  zero disallows redirect/retry/upload replay despite CLI/Retry-After overrides.
  Root reports138 author+63 regression,604 same checks in archive and moved pack,
  7 mutants. This is later scoped evidence, not included in frozen8670.
- Env-S exact8 fixture migration5ba1a0f3 independentlyec4e264d retains old29/37
  beside revised37/37+16 controls. Sourceea409a6b remains qualified30/30 scoped,
  native17/23 using a Linux argv MODEL, not kernel execution. Expr-match shared
  protocol/client/worker extension is in progress, not accepted by this ledger
  entry. These distinctions must remain explicit in any later gate candidate.

### 2026-08-27 17:39 UTC — successor73 readiness only, no new gate

- Read-only committed observationc355751f36ca3fdbab8f888eaab30203c1bcd343,
  unchanged HEAD during inventory:600 canonical test paths (old8670:560),
  73 explicit aggregate names, zero runtime dependencies. Package.json hash
  691426f4934c471d2a76d49675f3fc19f3ddc47c8aa63cc38671d899a09c4535 is a
  manifest hash, not a new tarball. Meitner's review of isolated3dc0ac26 remains
  pending at this observation; no current-HEAD product execution is inferred.
- Readiness blockers: inherited native assets48/49 (installed Codex rg content
  no longer matches required4298efd4…; observed5d24e1af…);190 committed.mts versus
  179 classified, eleven unknown; two canonical split/stream-format registry
  fixtures still assert70; existing full-gate drivers/public smoke remain
  historical70-name b494/8670 bindings. Do not relax these checks to launch.
- New expr/du native binaries match their local author hashes but are absent
  from inherited49 staging; expr has a mandatory behavioral qualification and
  du an explicit optional live-oracle skip. Both need final cohort/profile
  routing, not an assumed49-asset coverage claim. No native semantics ran here.
- Treef1a90436, expr/shared-regexfe7083d9 and du877144ea are committed author
  changes with independent review pending. Nondefault expr changes shared worker
  code; nondefault du is still built/discovered. Owned-output S1a61e63bc remains
  TEMP artifacts, not production. Root must choose a truthful complete candidate;
  no live overlay, hidden source exclusion or false HEAD label is authorized.
- Cleanup binding recomputed from explicit Git blobs has244 inputs here versus
  historical220; exact old220 reconstruction matches. This is readiness data,
  not a launch envelope. Final candidate needs its own source/tree/cleanup and
  native/package/harness receipt, Node24.11.1 guarded runtime, actual-child
  permissions/TAP, typecheck:all, explicit runtime consumers and concurrency2.
- Five split writer sources/helper and direct-curl canonical writer fix remain
  byte-identical to accepted repairs. Directcurl5f7fe5d7 was already in8670.
  Capture flags are unset. This does not certify all600 tests against writes:
  fresh admission checks exact entries, but existing post-phase verifySource
  only checks expected paths and does not catch added entries. Preserve scope.
- Historical8670 raw17454/12/0 remains unqualified; separate package2de7d99c
  remains scoped accepted, not whole-gate completion. Five custom first-read
  requirements remain known production failures; do not import S1 to hide them.
- Owned change: concise provider-reported allocatedBytes unknown/zero rule in
  AGENTS, no transient rules. Evidence and exact unknown paths/commit routing:
  tests/integration/full-gate-20260827/readiness-73/README.md and INVENTORY.json.
  No build, suite, service, private engine or package execution; root production
  files and foreign changes preserved. No superiority or release claim.

### 2026-08-27 18:22 UTC —73 gate-infrastructure author handoff, no whole gate

- Root relays independent public integration316b7efe on exact3dc0ac26:56/56
  frozen checks plus4/4 regex propagation, strict/negative types,22 manifest
  controls and138 retired workers. The omitted-README packaging discrepancy was
  rejected, separate from the successful exact-pack observations. Durability
  seal7f3ad2f5 preserves the604-byte raw commit and reachable14-path sources
  cb940da6/0bd5c20b+base0123: twice reconstructed exact commit/tree from isolated
  reachable-only object databases, fresh994dca packs match,4 negatives. No new
  refs; relocated harness paths were syntax-checked only, not new runtime proof.
  Earlier entries saying public review pending are historical observations.
- Root relays tree charsetf1a90436 accepted scoped: finala67ae4e8/0021a38a,
  main92d1dacd/native259d983a/mutants2748e2a.139 candidate/77 baseline;26/34→31/34
  exactly five connector fixes,15 counts,11 literal-native cases each source and
  moved package,762 files/176 loads/8 mutants. The earlier70-name isolated source
  and later73 integration remain separate. Holdouts were post-source, three
  native differences and old strict recipe remain; no full tree parity inferred.
- Exact accepted rg4298efd4… recovered from two retained authenticated copies;
  installed5d24e1af… has the same15.2.0 string, not the same bytes. Cause of the
  binary change remains unestablished. No expected-hash rebaseline/install/global
  replacement. Source1ebc9d71/evidenced4ed8322:7/7 controls and actual49/49 base
  asset assessment with explicit recovered RG_NATIVE_BIN. Expr/du are separate
  prerequisites, not silently included in the old49 claim.
- Two canonical registry fixtures migrate only six title/count tokens70→73:
  source7d1cebf6/evidence710ae52f. Whole original files24/26, revised26/26,
  precise count mutant24/26. A first negative generator also changed a hex
  literal and produced22/26; its harness defect and raw attempt remain preserved.
- Inventory source5c2a3744/evidencefcf661e8 individually classifies eleven inputs:
  six hash/source/package-bound historical captures, two maintained consumers,
  three imported declarations. New current-column retains meaningful types and
  awaited runtime behavior; maintained alias changes only two public imports.
  All179 prior entries unchanged;191 entries configure22 strict/19 runtime/3
  negative groups. Only the three new strict/runtime groups actually ran here,
  plus11 fail-closed/type/source-denial controls, not the entire configured set.
- Consumer attempt01 retained a canonical-temp-path permission defect; attempt02
  correctly exposed source3dc predating zero-capbb7f5972. No consumer expectation
  change. Explicit committedc355751f attempts03/04 pass3/3 new groups+11 controls;
  attempt04 adds73 names/27 imports/6 workflows/strict public types. Package SHA
  53ab62a59574d79607692ab2d67a22f8825bf7a68b1aa17b59392c9d7cf7bf0a differs
  from manifest691426f4… by artifact type.84 raw files/hash manifest retained;
  execution temp trees removed. Scoped build/consumer success is not acceptance
  of all pending source in c355, nor selection of a next whole-gate candidate.
- Integrity source0abce394/evidencebb4c152e adds deterministic added/removed/
  changed/symlink inventories before/after child phases, sealing legitimate
  source/build/install setup outputs. Capture outputs move to unique OS temp;
  staged rg is no longer overwritten by ambient rg.34/34 controls+2 detected
  mutants; actual whole runner unexecuted. Before/after checks do not detect
  restored transient writes or imply an atomic snapshot/universal host sandbox.
- Profile source522e8e27/evidencef18117aa generates only explicit full-SHA DRAFT
  receipts from Git blobs; HEAD/live overlays/rehashed omissions/native changes
  reject.23/23 controls (prior19 retained). Historical c355 calibration matches
  exact244 cleanup inputs/600 canonical paths and honestly reports its old11
  unknown inputs. No new root-selected cohort or launch; old8670 driver remains
  bound8670. Meitner's0895926b review is next. Expr/du/overlay and owned-output
  TEMP work remain separate pending scopes unless root supplies later acceptance.
- Handoff and exact source-file binding:
  tests/integration/full-gate-20260827/candidate-profile-73/HANDOFF.md.
  No fullgate, service, actual private engine, dependency change or product edit
  in this corrective infrastructure task. Original8670 raw17454/12/0 remains
  unqualified and its package cohort separate; no rescoring/superiority claim.

### 2026-08-27 20:35 UTC — root accepts owned-output component, not whole release

- Root accepts additive production component
  eba049535d154f4e028f57ffd8efd7622b2239ca following independent
  35909b63e39496965d56913669da1f3f0ba04a1e. This promotes the reviewed mechanism
  from the TEMP work into an accepted component; it is not whole-release/global
  green, full first-read compliance, arbitrary host preemption, or superiority.
  Source tree62d75ef09e89d4d3b6afc032c518d2846dcd03b7; scoped nine-path diff SHA256
  83b339002970df881efb56cc50fa0e0e74f1f832edb6c8706287827a3dc5e4ad.
- Independent evidence: unchanged frozen36/36, unchanged legacy505/505,
  current actual SafeJS25/25 qualified profiles (two surface rejection profiles
  are not successful guest-capability proofs); strict public positive plus8
  negative types and factory identity,11 binding controls,7 detected behavioral
  mutants. Exact moved tarball SHA256
  280b76a2a3577176716534e13d2e10475eb8a13e423190a24d25555a050f72e1;
  260 archived inputs,826 installed files and184 loaded package modules bound.
  Node22 product/build controls and Node24 guarded current-engine profile remain
  separate. Actual engine regular-file copies/private guards pass; no private
  modification or upstream proposal acceptance. Owned children retired naturally.
- Candidate commit changes exactly nine production paths. Against older baseline
  a03b9288a6f4b652387be9fefa8faf17ef58b9e7, four intervening expr paths are also
  present: src/commands/expr/{README.md,evaluate.ts,index.ts,internal.ts}. They
  were included honestly in the frozen package, not approved by this review.
  streams.ts changes only import/cat; shell/input.ts and network/shared.ts match
  baseline. No fixture expectations were changed for the36-case review.
- Root explicitly releases Sagan's exclusive nine-path source reservation:
  src/contracts/{io.ts,output.ts,index.ts}, src/shell/{runtime.ts,shell.ts},
  src/commands/network/{types.ts,transport.ts,curl.ts}, and
  src/commands/streams.ts (the reviewed change was cat/import only). Future source
  owners require separate root assignment; release does not authorize new edits.
  Getopts stage2 still awaits Poincare mapping/root approval. HTML source remains
  Dirac-owned for the bounded normalization repair; no HTML/public acceptance.
- The unchanged original first-read cohort is **2/6 pass,4 fail**, not waived.
  All six exact test names begin `hard-deadline pipeline close: ` and are
  registered by tests/shell/remote-close.test.ts:15; child behavior/assertions
  are tests/shell/first-read-probe.ts. The original five requirements are local,
  S3, WebDAV, curl-body and curl-headers; head-zero is the additional sixth control.

  | Exact name suffix | Frozen eba behavior and failure boundary |
  | --- | --- |
  | first-read-head-zero | Pass: reads0, return1, active0; existing zero-read control. |
  | first-read-local | Fail: unchanged1200ms deadline. Unenrolled custom pending-stream remains in first next; reads1, return0, active1 before failure teardown. Genuine unfulfilled custom settlement/cleanup requirement, not evidence of a post-teardown leaked process. |
  | first-read-s3 | Pass: operation/transport abort, source finally, reads1, return1, active0 before teardown; caller remains live. |
  | first-read-webdav | Fail at first-read-probe.ts:103: whole command-context signal is not aborted. Raw trace does show DAV operation-signal abort and cat141/true0 settlement; later source-close assertions are unreached. |
  | first-read-curl-body | Same line103 failure: command-context signal remains live after curl141/true0 settlement; later source-close assertions unreached. |
  | first-read-curl-headers | Same line103 failure and scope as curl-body; GET has not supplied headers, later source-close assertions unreached. |

- The three HTTP assertions observe middleware context.signal, whereas the
  accepted contract closes destination-owned operations without requiring whole
  context cancellation. That assertion targets the wrong scope for this new
  contract, but remains a raw test failure until a separately approved migration.
  At the failed assertion their server-side witness is active1/return0. Because
  the await of closed.promise at line105 is never reached, these observations
  prove neither successful server cleanup nor an owned-client leak; server close
  notification is a distinct witness. Separate N07 independently proves owned
  curl client close before public settlement and task-owned server cleanup before
  test completion. No extrapolation of N07 to every first-read scenario.
- Both independent original-cohort runs preserve the same2/6 result. All six
  children report no supervisor timeout/residual process group; local's1200ms
  assertion deadline is distinct from the3000ms supervisor. Existing teardown is
  failure containment, never acceptance rescue. Current fixture files remain
  byte-identical to the frozen candidate at this docs checkpoint; no new live
  product execution or fixture migration in this update.
- Root-reported maintained typecheck remains nonpass with13 foreign-test
  diagnostics (3 regex continuation,10 du local captured-package bindings), no
  src diagnostics;22 maintained consumer groups are a separate scoped pass.
  Author FOREIGN-TYPECHECK evidence is in
  tests/integration/owned-output-production-rebase/author-public/results-v1/
  FOREIGN-TYPECHECK.txt. No config/fixture exclusion or rerun here.
- Complete independent receipt, retained driver failures and exact paths:
  tests/integration/owned-output-production-independent-20260827/candidate-v1/REPORT.md,
  CHECKPOINT.json and MANIFEST.json. Source/fixture/evidence history is unchanged;
  only this acceptance ledger and missing durable owned-output rule are added.

### 2026-08-27 21:54 UTC — first-read facts, typing author scope and HTML74 handoff

- First-read production followup is sealed at7bbfbfd3 (v2observer8a674adf),
  under tests/integration/owned-output-production-independent-20260827/
  first-read-followup. It preserves the original five1/5 and extra-control2/6
  failures, not rescoring them.24 observer processes/108 evidence files inspect
  actual frozeneba output scopes before harness release. Unenrolled local input
  and cleanup-registration-only controls remain pending; explicitly enrolled
  cooperative operation cleanup settles. HTTP operation/client cleanup and
  required file/header/stderr work are distinguished from whole-caller abort;
  new body-acquired profiles do not replace original acquisition-time observations.
  The exact proposed three-file canonical migration remains unapplied and needs
  separate root authorization. No runtime edits were made for that followup.
- Regex fixture typing repair ec59c917/29cfda34 (+759e9218) is separately
  root-reported accepted: three diagnostics removed by a checked local descriptor
  annotation, emittedJS4812bytes identical, same cases/assertions and negative
  sensitivity. It does not rescore the historicaleba13 diagnostics.
- DU typing/classification author source5f6960a2/bca8848f/491da31c and
  evidencee9843e60 exactly classify14 unchanged inputs (old10 plus individually
  discoveredv6-v9), not directories. Six captures, five versioned templates and
  three reusable templates retain exact bytes/owning manifests. Maintained DU
  leaf localPackage:true provides actual strict/moved-runtime coverage, not a
  publicDU export claim. Frozen491da31c typecheck:all builds once then succeeds;
 23 current strict/3 intended-negative groups and75 author controls are separate
  from whole-product tests. A Node24 nested-spec-vs-TAP fixture issue remains
 7/8, while Node22's same compiler-policy fixture is8/8; no waiver. Different
  review remains required for these config/typing changes. Evidence:
  tests/integration/du-type-workflow-20260827/README.md.
- Root accepts HTML module9ae34a06 after independent37ec9390 for the specified
  normalization fixes. Two unsupported title expectations and two historical
  poison-launch failures remain; the old module-closure pack is not public/full
  package proof. Root returned HTML source ownership and authorized a separate
  index/I/O-only explicit owned-output adoption plus public/default integration.
- New author source/export/docs28cf1518 changes only HTML index.ts behavior;
  input/budget/parser/render/options/entities/text remain accepted9ae bytes.
  Root and literal commands/html-to-markdown expose the three existing factories/
  plugin and options/limits types; aggregate htmlToMarkdown omits replace and
  top-level replacement remains authoritative. Default inventory becomes74;
  curl/SafeJS remain opt-in, du/expr are absent. RendererSHA256
  a624213e0289a441f1cacbf128dbac0861d23aee0ca3d7a2ad2f98a1d5da6378.
- Frozen author candidateaff899aa94ed0c57a936b08fd36d185688f5c0bb,
  tree9641374115db435022ac172ec9c99d305e07dbe4:257/257 selected source tests,
  strict source/public types, four exact negative-type diagnostics, eight moved
  programs across Node22.22.2/24.11.1 (six lifecycle cases per runtime,74 literal
  names, four API/VFS workflows and two maintained stream consumers), four
  fallback controls and both actual permission/source-denial profiles pass.
 20 subprocess steps reach their intended statuses;22 explicit checks pass.
  This is author-scoped evidence, not different-agent/public acceptance or a
  whole gate. No new source changes after that candidate are included.
- Exact package.json SHA256
  aaea215e419a64b08e4739dee1a6b7bba5f41f9d5e1c93d4d1771f939e904842;
  full .tgz SHA256
  d9c1a97388357c5cb0c810cf2fa5181dc7bebff49efe517db414a5833096eed7.
 830 installed/828 emitted files and410 scoped Git inputs remain unchanged,
  including additions checks;194 actual main-thread loaded modules are bound
  per lifecycle run, not worker-thread tracing. No dependency installation or
  private checkout writes; all task children settle naturally.
- Controlled curl-to-HTML-to-head0 admits one read then completes return/dispose
  before settlement, with caller live. A required header-file destination keeps
  its curl request scope live while retiring the body; redirected Markdown and
  required stderr survive unrelated stdout closure. Direct HTML rethrows exact
  operation-close reasons after cleanup; caller identity has priority, unrelated
  caught errors retain existing status1/stderr, usage2. It does not add global
  abort, arbitrary opaque-input preemption, or silently change canonical first-read
  requirements. Existing frozen direct-close unscored reviewer boundaries are
  not amended by this author description.
- Exact test migrationsb2eb06ce/831f1712/b983a37f add only required HTML names/
  counts/current inventory hashes and the explicit owned readFile signal binding.
  Earlier failed author/source/packed attempts remain in the52-input lossless
  evidence bundle; no product fix was fabricated from harness corrections.
  Full handoff: tests/plugins/html-to-markdown-public-author/README.md.
- Meitner independent fixture54f1e4d is ready, not run by this author. Its full
  archive admission rejects12 pre-existing historical native tree symlinks and
  buffers at most1GiB whereas this candidate's full Git archive is2.2GB. Root/
  reviewer need versioned admission handling for authenticated inert links and
  streamed archive bytes, without weakening product/build/package guards.
  The separate blocked binding receipt is not an accepted executable declaration.
- Root separately accepts initial DU9a5a6f92 scoped independentd53b003b: original24
  source+moved, fresh40each, env16each, metadata19each with only permitted directory
  atime deltas,128 regressions and789-file packed strict consumer. Native16
  executed/13 matched/3 diagnostic-predicate mismatches retain original13/16;
  status1/emptystdout were correct, not an established product bug. The native-only
  predicate correction is separate. Allocation/order/O060 and historical lineage
  qualifications remain. DU75 public integration and new pure-output adoption are
  queued only after this74 HTML freeze and root's exact handoff; no DU source,
  exports or defaults changed here. No broad-release/superiority/72-hour claim.

### 2026-08-27 21:57 UTC — separate DU native-only qualification received

- Root accepts290e175d for overlayd71d0789's one native diagnostic predicate:
  one16-row replay is16/16 (13 literal matches and three strict40-byte invalid-B
  rejections),14 focused controls, pre/post tool/base/patch hashes,19 roots retired
  naturally. Original13/16 and the unrun success-only tail remain historical;
  this is not another full cohort or composite whole-gate acceptance.
- Initial DU module/purity scoped acceptanced53b003b still stands. Raman prepares
  a separate publicDU75 freeze while HTML74's different-agent review proceeds.
  The exactaff899aa HTML candidate/default inventory/package remain untouched;
  no DU source/public integration is performed by this handoff.

### 2026-08-27 22:57 UTC — separate DU75 public author candidate ready

- Root authorized DU integration after HTML74 was bound, with Raman's immutable
  pre-candidate freeze1bd1048b. Source/export/docs b2b4604f adds root and explicit
  `virtual-bash/commands/du` factories/types, `AgentCommandsOptions.du` limits and
  top-level replacement authority. Default75 is exactly HTML74 plus du; curl and
  SafeJS remain optional, expr76 remains unwritten. HTMLaff899aa and its full pack
  d9c1a973 are not changed or silently recounted by this separate candidate.
- Frozen author candidate0895de2dc63014989f23912c3d48f7c4d0d35a47, tree
  0d6fe4cc764e047c0f4c9eb93cfaa3824be36965, complete tarball SHA
  4d4d071a0142ac950240f7c3aaacd5283777143d70cc2e3c245ba199fdd01c7d.
  Its package.json SHA60e3e393 is a different artifact.834 installed/832 emitted
  files and771 scoped committed input files are authenticated; all200 observed
  main-thread modules per moved program match captured expected bytes. No worker
  dependency tracing or entire historical-repository archive claim is made.
- Only DUdu.ts/budget.ts behavior changes: optional owned stdout enrollment after
  validation and before metadata, one unchanged budget, operation-scoped metadata/
  accounted stdout, original-caller required stderr. Exact direct close reason is
  rethrown; caller abort takes priority. Owned local waits/close are awaited, but
  opaque underlying provider promises are not forcibly retired. Known allocation
  zero, absent allocation and explicit apparent-size mode remain distinct.
- Frozen build/scoped strict types/public strict types pass; four intended negative
  type diagnostics, eight moved programs on Node22.22.2/24.11.1, four fallback
  controls and two actual source-read permission denials pass.166/166 source tests
  comprise102 unchanged non-native DU,13 new DU,9 HTML lifecycle and42 registry
  checks.20 author harness commands/22 checks pass; no skip/TODO. Source/artifact,
  built and installed inventories are unchanged with added-entry detection.
  This is author-scoped evidence, not Raman acceptance or a current whole gate.
- Original17284 isolated attempt remains failed: missing archived WebDAV mock
  helper produced156/157 source results plus count/type failures; its eight public
  programs passed but that did not make the attempt pass.0895 adds only the helper
  to archive selection; both attempts have identical product tarballs.52 raw logs/
  reports preserve both attempts and prior source/type diagnostics. Exact current
  fixture migrations9cccda89 preserve prior74 evidence and change no tool semantics.
- The package also contains separately authored private cancellation helper67472272
  and its four emitted files; it is not imported by these public programs or
  approved through this DU review. Later first-read canonical migration commits
  are outside this scoped run; Heisenberg owns that separate work. No runtime,
  HTML renderer, expr or DU-independent fixture was edited for this integration.
- Handoff and eight lifecycle mapping sections:
  tests/plugins/du-public-author/README.md and POLICY.md. Receipt
  evidence-v1/REVIEW-HANDOFF.json SHA1ff91fcf815f57a895bf46d4aeca8e5da488971d918009dbb1d24b356e7f5b8a
  binds exact source/Git blobs, package, tools, names and policies. Root must route
  that candidate/mapping to Raman; author does not invent independent executor or
  root replay authorization. Different-agent public/lifecycle review remains open.
- Separate DU typing-author evidencee9843e60/frozen491da31 has not been recast as
  a current global type pass. This integration ran only build and scoped checks.
  No whole gate, external native/service replay, superiority or72-hour completion
  is claimed.

### 2026-08-27 23:10 UTC — TAP fixture author repair, expr76 declaration and received scoped acceptances

- Root accepts DU type-classification/installed-consumer review397894e0833a84fcd86d34102548faa78e9d988d:
  fourteen original files unchanged,41 admission negatives, canonical role-swap
  rejection, authenticated830-file author package (not independently rebuilt),
  installed/moved DU leaf and two unique byte-identical template compilations.
  The reviewed Node24 canonical7/8 remains nonpass; original evidence is not
  recast as global typecheck or independent public DU75 acceptance.
- Root-authorized fixture-only commit e422ad06b3470477b7f9323c89289d2963a00407
  changes exactly two lines in qualified-current-release-native-data/controls.test.ts:
  explicit current-child TAP argument and historical-script TAP before its glob.
  Historical before-02.json, all assertions, synthetic input paths, script
  semantics, root compiler policy and product source are unchanged. A new frozen
  author replay gets Node22 baseline8/8 and Node24 baseline7/8; repaired inputs
  are8/8 on each runtime, with two targeted reporter-removal controls failing
  their intended count assertions.19 supervisor checks and scoped strict test/
  helper types pass, no skips/TODO. Different-agent Meitner review remains pending.
- These are13-file isolated fixture/config selections, not a product archive or
  broad suite. Actual npm/compiler/test startup observations use the selected
  Node22.22.2 or24.11.1 throughout, with the pinned existing npm10.9.7 CLI explicitly
  run under each binary. Inputs are unchanged including added-entry checks; tools
  have named before/after hashes. Original author npm-configuration setup failure
  and its uncredited negative controls are preserved alongside the fresh corrected
  supervisor run. No product failure was fixed or scored through that harness fix.
  Evidence: tests/integration/native-data-tap-author-20260827/README.md.
- Expr76 remains HOLD pending root's different-reviewer freeze. The source-inspected
  declaration at docs/integration/2026-08-27-EXPR76-PUBLIC-PLAN.md specifies root/
  explicit expr subpath, existing factories/types, aggregate
  `expr?: Omit<ExprCommandsOptions, "replace" | "regex">`, global regex authority
  even when omitted (nested runtime regex is ignored), family limits and top-level
  replacement. Direct factories retain their own regex options. This extends the
  existing grep/alias global route without silently altering other family routes.
  No expr source, exports, defaults, counts or TEMP nullable-history promotion has
  been performed. Initial restricted guard/quota/profile limitations remain.
- Root accepts the qualified getopts real-guest followup6133b271 and corrected-G2
  freeze1cf6596a/evidence7345d0bd. Original distinct-probe1/2 remains unchanged;
  the separate corrected G2 executes1/1 with7 completed guest assertions, beside
  G1's prior4. The successful captures together observe9 actual builtin entries
  (4 plus5), not a new25-profile replay or a rewrite of earlier setup/guest failures.
  No private checkout writes occurred in those guarded captures, and none was
  accessed by this ledger/TAP work. Getopts is a builtin, not a default plugin
  increment. These received acceptances do not establish current whole-product
  green status, full SafeJS closure or superiority.

### 2026-08-27 23:36 UTC — Expr76 public author candidate and received first-read migration

- Root authorized expr76 after the TAP fixture candidatee422ad06 was sealed and
  Meitner's independent fixture freezef8b982f09e51b9a0a073b0b7bb393cb54796dd62
  arrived. The preceding HOLD declaration is historical, not current authorization.
  PRE-WIRING.json authenticates clean root absence at200237e9 and at that freeze;
  accepted DU750895de2d's literal75 names are unchanged apart from adding expr.
- Public wiring sourcea1c95fc52ddeef2d753950b09dd2a26b44b4ab6e adds root/explicit
  commands/expr exports and aggregate expr limits. Global regex and top-level
  replacement remain authoritative; unknown nested runtime regex is ignored even
  without a supplied global regex. Direct factories retain their own options.
  The nine expr/shared-regex TypeScript files remain exact acceptedc3e40f8b bytes.
  No TEMP regex research, guard relaxation, stdin acquisition or owned-output
  adoption is included.76 default plugin names exclude builtin getopts and
  optional curl/SafeJS. HTML74 and DU75 frozen packages are not altered.
- Final author candidate44f00bf84278e3361b52106478d59c707ab7b2bc produces complete
  tarballc109372f90b1bd19bcf756cf993bb2976fb52b75fe0c92a1cf96dab4c229b5cd;
  package.json separately hashes513f26e135e7f499b8fb92b7981b2e82a2e91d512db88518f48daf81c1bbf74a.
  Build/scoped types and74 source tests pass without skips/TODOs.32 command outcomes
  and35 supervisor checks match;16 installed/moved programs run across actual
  Node22.22.2/24.11.1, with strict root/subpath consumers, six negative types in
  each layout, missing runtime/export/type controls and genuine source-read
  denial.834 installed/832 emitted files and357 committed input bindings remain
  unchanged, including added-entry inventories. This is not a whole-repo gate.
- The12 author public cases per context retire44 observed workers across four
  contexts, with205 main-thread load hashes per context and actual worker module
  bindings. R25's author startup marker follows exec plus finally-dispose; the
  independent protocol must additionally observe exec before dispose. R26 checks
  exact caller identity, real exec/dispose cleanup and live sibling isolation
  using held genuine worker replies, not a claim of CPU activity at cancellation.
  The full package contains a separately authored private cancellation helper
  change relative to DU75; it is not loaded or approved by these public observations.
- Evidence8d07bd6e7549aaa9a1096c3e9278b231692bc699 preserves the initial72/74
  fixture failures and truncated receipt, then74/74 with a synchronous receipt
  EAGAIN failure, beside the final success. Registry-copy identity and one stale
  HTML expr-absence assertion were corrected separately from async receipt
  draining; product bytes and all three tarball hashes are identical. Meitner's
  unchanged26-case independent review and P01–P08 protocols remain pending.
  Handoff: tests/plugins/expr-public-author/README.md and evidence-v1/REVIEW-HANDOFF.json.
- Root separately accepts first-read canonical migration073d39c6 through
  independentda828571:10 canonical plus10 independent cases,12 controls and199
  loaded-module bindings. Original1/5 requirements and2/6 extended observations
  remain historical failures, not rescored. This is a received fixture-profile
  acceptance, not new runtime source work or a whole-release claim.

## 2026-08-28 — Unified76 v3 author packet and received scoped acceptances

- Complete four-file fixture amendment frozen at7e8b9377, source284a4c5a;
  final76 candidatef5e9fc49b6abb38e180cc9de16c95fced102ff75 is base44f00bf8
  plus those same four paths. The only remaining edits were the inspection
  title, unique count76 and HTML/DU/expr suffix; custom counts remain77.
  Two actual builds produce the unchanged full c109372f… tarball. The first
  author selection executes49 cases successfully but has one missing-helper
  module-load failure; a fresh same-candidate completion executes the remaining
  19 format cases. This is not relabeled as one uninterrupted68/68 run.
  Prior07047's67/1 and2ffcb23d's20/1/unreached suffix remain historical.
- Integrated external launcher source2713defc1f53a00dd975931946de4782a980836d
  has56 bounded author controls passing, including actual small Git transport,
  inventory routing, inert imports and unreleased-run refusal. Its reviewed
  inputs are proposed, not independently accepted:632 canonical paths,
  192 classified.mts,256 cleanup inputs,37,397 committed blobs/2,382,440,321
  bytes and native49+2 hash admission. Explicit--run, one driver build reused
  by consumers, bounded setup/output and strict cleanup/zero-skip exit policy
  are implemented. Root's OS exception is only eleven sampled unreadable
  references on macOS26.4.1/build25E253, not file hashes/full OS attestation.
  Evidence:tests/integration/full-gate-20260827/unified76-driver/launcher-v3/
  evidence/REPORT.json. Dirac's22 groups and the full gate are not executed here.
- Received root acceptance of HTML74'saff public component through
  independent9d84903356a4c33402814bdc367e3bbe9894d1c2: the same34 cases in
  installed/moved Node22,10 type/10 package classes and authenticated830-file
  d9 package. Prior build/archive proofs were bound, not rerun; close-disposition,
  stderr, title/HTML5/non-sanitizer and conversion qualifications remain.
- Root separately accepts WHICH77's284/ee component through0b41da23: unchanged
  18 runtime+4 type cases installed/moved and8 weakening classes. Its immutable
  candidate284857d7… and49191d09… package are not rebased into this76 gate.
  Root also accepts Stage2fd1daa12 through7ca45f2d:26 runtime/6 types,2 controls,
  three layouts and separate280+39+68 regressions. The frozen M05 mutant survivor
  remains beside the separate private-seam kill; SafeJS follow-up is pending.
  Stage2 stays outside selected76. These are received scoped acceptances, not
  a combined candidate or whole-product gate result.

### 2026-08-28 — Coherent77 + Stage2 author readiness, no gate

- Root-authorized candidate5137a74ec855a32d8a8860eb66b62eb44d11e290 has
  parent284857d7aa9b0ee0df2b6fdd1a71f41115d7b909, helper57855a02 and exactly
  five Stage2fd1daa12 runtime/contract/doc blobs. Its other four changed paths
  are the maintained inventory fixtures in7119f0c084e8d4f50074ca4c47c7311bc48792c8:
  fifteen predeclared lines, exact77 defaults and78 for one custom registration.
  No fifth fixture, timeout, TEMP research or unrelated live source was included.
  Historical76f5e9fc49/driver2713defc and WHICH77's original candidate stay fixed.
- Source/verifier ef283a6425ab1fa078c1e7cc7d51e2426dd8a5f1; evidence
  e8ab954d8fa7cc50b0ebccaa5c4e5bea178d892e. A fresh build/fullpack executes
  all four affected fixture bodies68/68 with zero failures/skips/TODO/cancels.
  Unchanged WHICH18/18 in each installed/moved Node22/24 context is an author
  combined replay, not independent combined acceptance. Five strict public
  consumers and four exact negative-type diagnostics pass in each layout;
  same-package declaration resolution, source-denial and missing-runtime
  controls execute. Twelve additional envelope/admission controls pass.
- Actual rebuilt tgz SHA13fe54de1cf900d587855e276375fdf72ed1ed0d0e0625cf7ef00730f2bb74c9
  contains846 regular files/844 emitted files. It legitimately differs from the
  historical WHICH-only49191d09… tarball after Stage2 changes. The distinct,
  unchanged package.json SHA is64846cc0868630f863fade5119cef195a949aa0ed36ecc341bd9a076d6c363e2.
  Evidence binds271 committed inputs, complete copied main/npm dependencies,
  executable identities and unchanged source/package/consumer inventories.
  All29 captured final commands exit naturally, retaining expected negatives.
- The initial author attempt remains failed:47 source cases pass, then packed
  consumers are denied before product execution by a /var versus /private/var
  permission-path mismatch. Only the new verifier's temporary root is resolved
  to its physical path. Fences/expectations are unchanged; the subsequent68-case
  result is a fresh run. The uncommitted initial verifier has no pre-run source
  hash claim; its reconstructed two-line delta and raw diagnostics are retained.
- The exact three-commit synthetic chain is reconstructed twice from reachable
  anchors and sealed raw commit bodies, with candidate objects initially absent
  and no refs created. Compact evidence contains79 indexed raw files, not product
  archives/node_modules. Entry point:
  tests/integration/combined77-stage2-readiness-20260828/README.md.
  No full gate, global typecheck, native suite, private-engine suite or new77
  driver runs here. Combined independent acceptance remains pending; scoped
  readiness does not establish broad parity or the user's superiority objective.

### 2026-08-28 — Bounded user-facing README smoke on combined5137

- Documentation/smoke source b37cf57280dcdfc8495aba6d5fb974c228ed0f6e and evidence
  e7690860f56b18052375c4f24eda82628bb321fb exercise fixed product
  5137a74ec855a32d8a8860eb66b62eb44d11e290. The previously built full tarball
  13fe54de1cf900d587855e276375fdf72ed1ed0d0e0625cf7ef00730f2bb74c9 is reused,
  not rebuilt/repackaged. All846 regular package files authenticate before/after
  extraction into a fresh consumer. Current README is a separately bound input;
  neither this package's README nor frozen76's documentation is overwritten.
- All13 TypeScript snippets plus the explicit staged workflow template compile
  under strict public-package types. Node22.22.2 and24.11.1 each pass15 checks:
  nine exact standalone examples, three contextual table/tar/HTML workflows,
  and three network/API controls. Default77, optional curl/SafeJS exclusion and
  builtin getopts exclusion are asserted. MemoryFS/pipes/stdin/getopts/which,
  mock curl per-hop authorization, denied redirects, binary stdin/VFS transfers
  and response cleanup execute. The external HTML snippet is typechecked and
  its workflow runs with an injected mock, not against an external service.
- Actual forbidden-source reads fail under both runtime permission fences;
  three direct network-trap controls per runtime reject before sockets open.
  Complete consumer/package/development-dependency inventories remain unchanged.
  SafeJS factory types compile, but no engine/guest/private checkout is used.
  This tests zero-runtime-dependency package usage, not absence of development
  tooling or optional host-engine requirements, or an OS/opaque-CPU sandbox.
- The initial author harness compiles the snippets but records two node:test
  file-launch permission failures before product bodies. Direct module imports
  with explicit TAP replace the harness's child-spawning discovery; no process
  permission is added. Its raw verifier/errors remain preserved. A fresh second
  run passes15 per runtime, followed by a fresh third pass after strengthening
  the existing API control with the literal77/optional/builtin checks.
- README fixes one stale76 count, makes the options import self-contained,
  supplies an offline typed curl transport and explicit stdin/getopts/which
  example, and states trusted-host/cooperative-cleanup limits. Existing AGENTS
  rules already cover these boundaries, so no duplicate rule was added.
  Entry point: tests/integration/readme-combined77-smoke-20260828/README.md.
  No full gate, native suite, product build, global typecheck, publication/latest
  claim or new independent combined acceptance is implied by this smoke.
- Received root's separate scoped acceptance of dc7ed138 actual SafeJS fd1
  regression:25/25,204 packed plus63 engine copies and private guards. It is
  not rerun here and is not new guest-signal proof. The prior component and
  original failure qualifications remain separate from README usability.

### 2026-08-28 — Unified76 review-only entrypoint; concrete A10 HOLD

- Source b0ee7234b915ce1ac45aa6db6d087dc3430ea21f seals version4 before author
  execution; evidence dfcb0069c6d2d87c46109fd028e215e70aaff67d. Driver JSON SHA
  4624ffcbafa470f21c6d122adc3e75a1c20744f8b75d80839f4e69eebcf3d0a1 binds30
  files. Productf5e9fc49, expectedc109 package, native/profile/cleanup inputs
  and old2713 source/evidence remain unchanged. No full gate is released.
- Full execution and explicit --review-build-types call the same extracted
  build/type phase and supervised phase runner. The design preserves cold78,
  actual typecheck:all, immutable inputs/dist-only build changes and the
  emitted-package receipt. A hash-bound inherited preload records actual
  production compiler invocations; count fields alone cannot authorize reuse.
  The full --run path still requires a matching root release. Imports are inert.
- Four bounded author groups pass, including two actual TypeScript builds of
  a separate tiny project rejecting the one-build check, preload tampering,
  and actual contained-link transport. The target still reports ps EPERM and
  denies outside writes. An explicit trusted outer read-only IPC observer binds
  requester PID/birth and admitted Git PID/group/birth, rejects foreign PID/
  handle requests and records natural closure with no survivors or signals.
  This is author evidence, not a new independent22-group score or OS attestation.
- Exactly one actual review-entry attempt exits1 before extraction/build/types.
  Zero candidate builds and zero typing phases execute. The unchanged
  transport.mjs:18 rejects two committed literal-backslash filenames under
  tests/commands/filesystem-inspection-stress/tree/: evidence/final-436bda3/
  harness/derived/native-fixtures/controls/back\\slash and
  sealed/native-fixtures/controls/back\\slash. Both are one-byte mode100644
  blob63d8dbd40c23542e740659a7168a0ce3138ea748, relative and POSIX-normalized.
  Outer cleanup is naturally complete, but A10 remains HOLD, not a type failure
  or successful integrated one-build proof. No retry or filename-policy waiver
  occurs. The proposed next version admits literal POSIX backslashes while
  preserving traversal/NUL/.git/symlink/hash/mode/byte checks and tests those
  exact files. Product/fixture inputs must not be renamed or omitted.
- Handoff: tests/integration/full-gate-20260827/unified76-driver/launcher-v3/
  review-v4/HANDOFF.md. Old19/3→21/1 and optional transport failure stay intact;
  c109 was not rebuilt in this attempt. Dirac's new independent review and any
  successor admission-policy correction remain separate from release approval.
- Received root's scoped DU75 composed29 acceptance (public4343b646 plus
  83645ad0) and combined5137 acceptance through7ebe10a0. These received component
  decisions neither alter frozen76 nor close its driver/full-gate HOLD.

### 2026-08-28 — Literal POSIX admission; one actual review-only build/type pass

- Source e062bcc1c79bf626541cc13ce35bad89e28dfe0a, evidence69a77055, driver
  3d8d2a15214f12c07b64e3223f5e0088989845b8f60a74abb0a521dba32fa018.
  Transport admits literal backslashes only on its explicit darwin/arm64 POSIX
  slash-separator profile. Traversal/NUL/absolute/link/mode/hash/byte guards
  remain; no Windows claim or filename rewriting. Productf5e9fc49, expectedc109,
  native/cleanup/profile inputs are unchanged; the tarball is not rebuilt here.
- Five presealed author control groups pass, including actual extraction of
  both exact committed backslash files and unchanged nested V4 duplicate-build/
  contained-observer controls. The target's ps EPERM and filesystem fence remain;
  trusted outer observation proves owned-child closure, not arbitrary OS safety.
- Exactly one successor review attempt exits0:37,397 entries/2,382,440,321 bytes
  authenticate; cold typecheck78; one actual production compiler invocation;
  typecheck:all0 with source/tests,23 maintained plus3 source-consumer groups,
  the historical build-first consumer and3 exact negative groups. Typing reuses
  208 declarations;832 emitted files are receipted. Guards and natural cleanup
  pass with zero forced signals/survivors. No consumer runtime or full gate runs.
- Exact raw reports/phase logs are losslessly indexed in launcher-v3/review-v5/
  evidence; HANDOFF.md routes source/controls/shared-phase receipt to Dirac.
  This is author proof, not independent A10 closure or a release. Prior dfcb
  zero-build failure, old19/3→21/1 and all historical gate results remain intact.

### 2026-08-28 — Composed Expr prerequisite accepted; unified76 packet held

- Root accepts composed Expr public recipea316d868fd6b330653f893276b8f5970dfe8800f
  and evidencedc5ca91d8405961784ca40a8b439aa8936ecbba3. Its MATRIX.json retains100
  runtime groups and qualifies4 correctedR21 groups with16 new boundary outcomes;
  types compose32 retained plus8 targetedN04 outcomes. Package36/P01/R25/R26/DU29
  proofs are bound, not rerun. Same44f00b/c109; the author archive binding is not
  a new independent full-archive proof or original104/40 all-green replay.
  Restricted expr semantics and original failed cohorts remain unchanged.
- HTML74, DU75 and Expr76 now have root's separate scoped public acceptances.
  HTML's candidateaff899aa and evidence9d849033 are distinct identities, not one
  concatenated commit. These prerequisites do not approve the full product gate.
- Pending launch packet39dd983bf60c6934d9d8721e39557eae487d88ef binds exact
  productf5e9fc49/base44 plus the same four fixture paths; unchanged src tree
  5876c6bf4ad9bc07f22cc46f8dbee99461981862 and expected fullc109 tarball. It is76
  defaults, not current77: no WHICH77, helper373/578, Stage2fd1, timeout or live
  product overlay. Existing owned-outputeba/getopts618/helperfbbe remain bound.
- The packet references e062/3d8d driver, profile8c9363,632 canonical paths,
  192 classified.mts,256 cleanup inputs, native49+2,61 readable tools/four
  dependency trees, and the exact approved11-reference macOS boundary. It records
  all14 ordered phases, expected negative exits, Node24/TAP/concurrency2,
  one-build reuse, permission/source fences, finite output/time/child bounds and
  nonzero/HOLD for missing bindings, skips/TODOs, guard or cleanup failures.
- Static checks verify the four-path assembly,30 driver and10 support hashes,
  fixed phase order and rejection of the deliberately pending release template.
  No new source materialization, build, pack, native run, private inspection or
  full gate occurs. Existing c109 independent pack and e062 author build/type
  evidence are reused, not repeated. Dirac's e062 acceptance and a subsequent
  explicit root release remain required; execution-time prerequisites must
  freshly pass. Old8670/d98b/334, old19/3→21/1 and prior failures are not rescored.
- Packet and exact launch instructions:
  tests/integration/full-gate-20260827/unified76-driver/release-packet-v1/LAUNCH.md.
  The template's pending action/false review/empty authorization fails admission;
  this documentation is not an executable release or automatic promotion.

### 2026-08-28 — Root released76; instruction-copy admission stopped before writes

- Root explicitly authorizes one f5/e062/c109 full76 run through packet39dd,
  accepts independent5c32f061c36081919a21cbc7e77b2865f0c49c0a (21 inherited plus
  one new scoped A10,13 observer controls, not22 fresh), and binding8dd78d7d.
  The same authority forbids AGENTS snapshots/materialization and requires
  stopping before an existing driver would make such a copy.
- Blocker evidencea9ec3561b36505d288519804980ee1b7641ee5dd records that exact
  conditional authority. The approved complete profile includes five AGENTS.md
  members/47852 bytes, and e062 unconditionally writes them. Its dependency
  copier also writes benchmark just-bash/dist/AGENTS.md (9231 bytes), the same
  pathname as the independently disclosed incident. All30 driver files still
  match the seal; the clean independent typing slice is not a full-extractor
  instruction-copy-policy proof. Earlier author69a's complete-copy behavior
  remains historical and must not be relabelled instruction-copy-free.
- No executable release receipt or full launcher is invoked: zero new archives,
  copies, private reads, native runs, builds and zero of14 phases. The conditional
  stop does not consume or rescore a full-gate attempt. Source/index/foreign
  processes and all existing evidence remain untouched.
- Proposed, not implemented: retain the full37397-member original authority but
  explicitly bind the five instruction files and one dependency file as metadata
  only, validate the physical projection without broad omissions, and address
  instruction bodies in full Git-history/private/nested-copy paths. Working-tree
  omission alone is insufficient. A new reviewed driver/projection and matching
  root receipt are needed; f5/c109 and canonical/profile identities must not be
  silently weakened. Exact files/callsites and remaining decision are in
  tests/integration/full-gate-20260827/unified76-driver/release-blocker-instructions-v1/README.md.

## 2026-08-28 UTC — instruction projection author packet, release still held

- Root separately authorized metadata-only projection for the exact five f5
  instruction entries plus one benchmark document, and original authenticated
  opaque Git objects as inert provenance. That exception never permits checkout,
  plaintext alternate snapshots, substituted instructions, or treating historical
  blobs as active rules. Original a9ec3561 five-plus-one defect/zero-phase stop is
  unchanged; its previous full-release authorization is not transferable.
- Metadata/control preseal794bfdbd, driver sourcefb376b3a0bd390598038494235bec321a694383d,
  corrected controls1152411d, evidenceacd04c3df74a5728fba1a29919b10c44cc4e2e0d:
  author14/14 control groups, including unchanged nested V5 5/5 and V4 4/4.
  V1 empty-directory cleanup error and V2 13/14 wrong baseline-import control
  remain preserved; neither needed a product/transport repair.
- One review-only actual f5 build/type slice passed: cold78, typecheck-all0,
  one actual production build,23 maintained strict groups,3 source groups and
  3 exact negative groups;208 declaration bindings/832 emitted files. Guards and
  owned-child cleanup pass. Logical37397/2382440321 bytes reconciles physical
  37392/2382392469 bytes; benchmark3497→3496 files accounts for its9231-byte
  metadata-only omission. All six targets absent after build. All832 emitted
  identities equal retained e062 output. Expected c109 pack is not freshly packed.
- Historical body-reading tree/regex opt-in replay helpers remain unmodified and
  are not certified by this physical projection. No canonical/runtime/native/
  private-engine/full-gate phases ran. Different Dirac review and newly bound root
  release remain required. Driver normalized SHA2922ac6400ecccce808431952e3aaccc97e20c2b4b2acc93041b514f52818809.
  Handoff: tests/integration/full-gate-20260827/unified76-driver/launcher-v3/instruction-projection-v1/HANDOFF.md.
- Separate future feature: root accepted timeout modulea23867d6 via Raman33518147
  scoped source+moved34/34, with numeric/diagnostic/type/control evidence; native
  and SafeJS execution remain0. Public78 freeze031d4ddf/manifest18e3c23c is ready;
  root authorized integration only after this projection packet. It is not part
  of f5 and is not yet a public/default integration acceptance.

## 2026-08-28 UTC — timeout78 public author candidate, independent review pending

- Public source382abba5a73ddad13ba424bafbe1992b4f7ca7e9 and unchanged accepted
  modulea23867d6 compose candidate67eab12e315054907ef4ef435c6bbca2f59e0c36
  from coherent775137a74e. Exactly seven product paths: four module files and
  root index/plugins/package; no WebDAV/XAN, lockfile or other live changes.
  Two initially candidate-absent object stores reconstructed its exact commit/tree
  through reachable anchors and selected blobs; no new refs/history rewrite.
- Root plus explicit commands/timeout export createTimeoutCommand,
  createTimeoutCommands, timeoutCommands and TimeoutCommandOptions,
  TimeoutCommandsOptions, TimeoutScheduler. Aggregate timeout omits replace;
  supported invoke/scheduler/maxTimerMilliseconds forward unchanged and top-level
  replace wins.78 literal default names; getopts remains builtin, curl/SafeJS
  opt-in, zero runtime dependencies. Accepted cooperative-only module behavior
  unchanged; no native/hard-preemption/OS-sandbox claim.
- Evidence2736db84: full pack6608d255828d1a4f3b2810ef6c32a2b0b57a9aaf0dd685597ce6725d381d6e06,
  858 package files/856 emitted,271 selected build inputs. Manifest itself is
  b8475443860bfb0513a87cf6970ce2953e1858f27911ad3854e55f69ff22aa12, not the tarball
  hash. Source/pkg/dependency/tool inventories and owned-child cleanup pass in
  the separately qualified package follow-up; no unexpected entries allowed.
- V1 preserved82/83 maintained, missing timeout suffix; V2 preserved83/83 plus
  12/13 new author runtime with wrong input-object identity assertion; V3
  preserved83/83 plus installed13/13 on Node22 and13/13 on Node24, then frozen
  T08 diagnostic mismatch; V4 had0 consumer commands due author inventory-field
  typo. Neither historical failure nor unrun remainder is relabelled green.
- Separate V5 reuses exact V3 pack without another production build:13/13 in
  installed/moved on both Node22.22.2 and24.11.1 (52 executions), four positive
  and six negative type payloads per layout, maintained stream-five21/21,
  two source-denial and three missing-entry controls. Separate4/4 assertion
  controls include two assertion mutants; two null-export refusals pass. No
  product-source mutant success, native/SafeJS execution or full gate claimed.
- T08's unchanged invoker typo is correctly rejected by TypeScript5.9.3 as
  TS2561 with the invoke spelling suggestion, not frozen TS2353. Author-only
  exact-code/location/message qualification remains for different Raman review;
  his freeze files and original failure stay unchanged. Five maintained fixture
  files have18 original count/name hunks plus one exact suffix addition. Extra
  amendment metadata was post-fixture after failed preseal generation, disclosed
  rather than claimed pre-code. Root README87c58987 is a separate current doc
  delta; exact candidate pack retains baseline5137 README, not silently rebased.
- Handoff: tests/integration/timeout-public-author-20260828/HANDOFF.md. Raman's
  public freeze031d4ddf/prepared executor58de5502 remains pending actual different
  candidate review. This does not release or alter historical f5/c109; projection
  sourcefb376b3a/evidenceacd04c3d still requires different review and fresh root
  authorization. Existing AGENTS cooperative/inventory rules already apply;
  no transient counts were added there.

### 2026-08-28T06:39Z — OS instruction-write fence author packet; full gate held

- Root approved the cedd4b96 exact two sandbox-exec/system-library ENOENT
  references on macOS26.4.1/25E253, not file hashes/full OS attestation, and
  the fresh confined write-root plus exact output-root policy. Primitive4e60fbeb
  and integrated source86038b27 add inherited OS pathname-write protection,
  PID/group/birth-bound outer observation and guarded sibling phase dispatch.
  Existing source/permission/network-listener/cleanup checks remain; no target
  process privilege was added to make ps work inside the sandbox.
- Driver SHA a99c9f24b9edee16ef959139b48905e943ee108080c0aa39511965103f32f26a
  binds unchanged f5e9fc49/c109/product profile8c9363ea/projectionb74e5756.
  The single actual review-only slice passes cold prerequisite78, then
  typecheck-all0 with one production compiler invocation,23 current consumers,
  832 emitted files and exact declaration reuse. Original37397 logical entries
  reconcile to37392 physical candidate entries; one benchmark instruction body
  is separately metadata-only. Outer/phase settlement and final source guards
  pass without forced cleanup. No full gate or pack/runtime consumer phase ran.
- Original and current unchanged mechanism each retain14/15: inside-ps spawn
  fails EPERM even under an allow-default sandbox. Outer protocol progresses
  6/6,7/7,9/9 with explicit non-clean negative receipts for abandoned work and
  a non-loopback listener. Final supplement6/6, native ancestry/alias controls,
  admission8/8 and unchanged projection14/14 are separate scopes. Generated-JS
  quoting and wrong nested-sandbox exit assumptions remain captured. Nested
  sandbox apply refuses71 before its target, not a target-execution proof.
- Controls65bb898d and the packet at
  tests/integration/full-gate-20260827/unified76-driver/launcher-v3/instruction-os-fence-v1/HANDOFF.md
  map all30 presealed groups without calling them30 fresh independent passes.
  Deliberately inherited writable regular-file FDs bypass acquisition checks;
  production launcher excludes them. This is not content-aware copying
  prevention or arbitrary-host-JavaScript/whole-OS isolation. A denied Xcode
  git cache write remains visible despite successful typing. Different Dirac
  review and a new root release remain required; historical failed gates stand.

### 2026-08-28T06:39Z — Root-accepted timeout public and workflow compositions

- Root accepted public timeout78 composed proofdd5b40c4/recipeef511785 on the
  unchanged67eab12e candidate and6608d255 full858-member pack. Runtime22 retained
  plus8 new in source/installed/moved,20 retained types,7 retained mutants plus
  genuine M07/A07,3 retained boundary controls plus B01 with7 capture controls
  and its actual receipt. Prior build/pack proof is bound, not rerun. Original
  22/30,3/4 and B01 missing bytes remain. Native/SafeJS/full-gate execution is0
  for this public review, not a claim about separate workflow evidence.
- Root separately accepted timeout/curl/actual-SafeJS composition: original
  144e0fca retains11/12 installed and11/12 moved (116/118,8 controls, all24
  instances attempted; actual enginebb23, mocked HTTP and private guards).
  W05-only01b8e0e7/recipe91e404ba corrects the exact curl(7) prefix and passes1/1
  per layout with10 assertions/4 controls. Composed11+1 per layout is not a
  rescore or new all-workflow replay. New W05 guest evaluations are0, with126
  engine loads/two run scopes; relevant original guest cases retain their
  actual-execution proof. No product bug, native/provider/service/full-gate
  claim follows. Neither composition enters fixed76 f5.

### 2026-08-28T06:39Z — Root-accepted noncollecting jq string-length scope

- Source74361026502d76b8c2b696f9c60e410ac9b78d95 accepted through independent
  Plato16c4502d:60 unchanged holdouts and93 regressions, actual moved package,
  typing and reversion control; no charge/API behavior change. Initial845-file
  runtime/declaration pack351e03ad omitted README and remains a qualified
  projection, not a full-package proof.
- Additive6d5cf6c6/recipe4e4fbb56 closes that package-only gap with fresh846-file
  packff230f2e9079cc843198533e412f836abb62e4ade63f4fa210b7269f7deb4eff:
  only exact5137 README added, common845 bytes/modes identical,3 manifest
  negatives; metadata/exports/zero runtime dependencies unchanged. No behavior
  or build replay/full Git-archive claim. This is5137 plus the one source branch,
  not automatically78/CD/XAN composition, and leaves f5 unchanged.

### 2026-08-28T07:48Z — Resolved-write acceptance and developer-tool route hold

- Root accepts independent38a4e7b scoped five write-safety phases plus actual A10
  and real duplicate-build denial, not complete release binding. Inert outside
  symlink creation is allowed; resolved writes through outside/instruction
  aliases/chains/renamed links are denied, as are outside hardlinks and physical
  directory imports. The historical tar refusal leaves216 ordinary neighbors;
  no rollback or preopened-FD protection claim. Prior creation-proxy2pass/1fail
  and all historical failed gates remain unchanged.
- Preseal0444f359 and bounded read-only evidence in
  `tests/integration/full-gate-20260827/unified76-driver/launcher-v3/tool-routes-v1/REPORT.md`
  establish the recorded otool-shim parent of xcodebuild's license check and a
  bare-Git typing-helper route. The proposed direct otool-classic binary has two
  additional, unapproved tool/system-reference pairs; exact path/hash/request
  are in PROPOSAL.md. No replacement tool or12 planned route controls executed,
  no shipping patch/new A10/full gate. Current f5/c109/profile/driver bindings
  remain unchanged; route implementation/review/fresh release are still required.

### 2026-08-28T07:48Z — Separate accepted components and explicit pending scopes

- Root accepts CD464 through2585f78d/192ab78b,846-file pack06ea635b. Its85 bound
  checks plus L24 use an actual Runtime scripted provider in each layout, not
  a model. Original L24 was BLOCKED after61 L07 Memory setup passes, not a
  failing executed L24 assertion. Private-work/yield invariants are pinned
  source proof, not dynamic counters. LET is Raman's exclusive runtime window;
  Poincare's stack work is deferred docs/freeze; Yq is pre-code only.
- Clarify the earlier timeout/curl/SafeJS workflow record: original24 SafeJS
  wrapper invocations cover7 programs across layouts,12 successes and12 expected
  rejects (6 cancellation,4 budget,2 guest errors). W05 continuation has0 guest
  evaluations. No new execution or historical score change follows this note.
- XAN stays unaccepted/unregistered;88 reference checks per layout do not close
  its overall resource-proof HOLD. Artifact-only88608b65 qualifies30 existing
  diagnostic-data checks and976 counterexample-data controls, with0 product
  executions/new acceptances. All195 failed/nonpass rows (98source/97moved) and
  161 obligation mappings remain unqualified in its STILL-UNQUALIFIED.json.
  F11 ledger/exact annotations are adapter-authored static arithmetic, not
  counter telemetry; receipts show only status1/empty output/coarse closure.
  Work/retention/yield findings remain static, unexecuted, with no author repair
  authorized. The28 finding observations and11 direct/22 invocation attempts
  remain held by the platform safety check: no retry, rephrasing or executor/
  agent bypass, and no inferred OS-denial/cyber-vulnerability/semantic-pass claim.
  Static gap inventory17735a5e does not change any historical score or f5 input.

### 2026-08-28T08:30Z — Direct developer-tool route author packet, review pending

- Root approved the exact otool-classic path/hash recorded in TOOL-ROUTES.json,
  solely for existing Mach-O inspection, and its exact libc++/libSystem ENOENT
  pairs as pinned macOS metadata, not file hashes/full OS attestation. No other
  DeveloperTools/unknown-library exception was added. Shipping source
  fe15f1e406fa1039accddec25c696ae7187f6135 replaces the selector route with
  prebound direct execution, finite18-alias PATH/existing197-entry Git core,
  native-stage extra-entry refusal and six inherited selector-exec denials.
- Evidence cdf2803e, detailed at
  `tests/integration/full-gate-20260827/unified76-driver/launcher-v3/tool-routes-v1/HANDOFF-v2.md`,
  records final author12/12 with all original expected groups retained. Earlier
  5/12 (volatile receipt identity) and11/12 (missing exact helper dependency) are
  preserved separately. The unchanged outer9 controls passed on intermediate
  source8b095f99, not freshly on final fe15. Actual unchanged frozen typing-helper
  execution uses300 staged files and direct Git, not a production build.
- Driver25ee4ded79df9c4fe0a9c8031721887dd7c8e22cb56f10d42b3d415eb30c0527
  retains all35 prior closure entries plus two explicit route files. f5/c109,
  exact-six projection, product profile and14-phase contract stay fixed. This
  turn ran0 production builds/A10/package rebuilds/full-gate phases. Raw230
  files are hash-preserved;36 exact protocol roots removed after identity checks,
  no signals/foreign-process/private-checkout changes by this worker. Independent
  Dirac closure/policy review and fresh root release remain mandatory. Historical
  xcodebuild/unknown-basename HOLDs and tar's partial extraction stay unchanged.

### 2026-08-28T08:30Z — Root-accepted LET scope, separate from fixed76

- Root accepts LET c26892c3a1a419311c9cf46a6c2976e696e00624 through independent
  08b0553148afdfdb95edd722a2cdd7f63935d470, reported in
  `tests/shell/let-independent-20260828/final-review/HANDOFF.md`. Original81/84
  source+moved remains; three versioned checks cover the remaining rows with
  all22 families. P39 uses explicit argument forwarding. P58's original set-u
  case is still unsupported; the new let-absent case tests default zero only.
  S26 preserves childInvocation-is-closed rejection and cleanup before root
  success. No original failure is rescored.
- Evidence includes167 regressions,5 type checks per layout,7 guards and7
  qualified mutant groups; original ineffective M3 survivor remains. Full846
  pack21c4858e6e4b857cd5e0d526159667621bcd206b4f1fd1ce1f84b54ad7abbace removes
  LET to recover464 byte-exact. This is scoped acceptance, not a default-count
  change or global gate. Root releases the runtime window to Poincare's stack
  work; fixed76 f5 and this worker's driver-only scope remain unchanged.

### 2026-08-28T09:04Z — Final-route acceptance; fresh fixed76 release still absent

- Root accepts independent97c081ec7c7f180889d3640c29d1cd5fd1b10752 for source
  fe15f1e4/evidencecdf2803e:8/8 route groups,3/3 shipping-fenced phases and3
  worker-side shadow refusals. Actual A10 records cold78/typecheck-all0, one
  production build,23 maintained/3 source/3 negative groups and832 emitted files,
  plus actual duplicate-compiler refusal. Historical Git/tar controls are bound,
  not rerun; appended-link refusal proves cardinality only. FD/TOCTOU/system-
  metadata/dynamic-image qualifications and all old results remain.
- The NEW pending packet d9dd698a33421b197ee15432a6606ad91dd06c63 is
  `tests/integration/full-gate-20260827/unified76-driver/release-packet-v2-final-routes/LAUNCH.md`.
  It binds fixedf5/c109, driver25ee4ded, profile8c9363ea, routesb440b324 and exact
  projectionb74e5756 to the accepted review. Metadata preparation executes no
  product/build/native/private-engine/full-gate work. The invalid receipt template
  does not inherit old GO; root must accept the packet then issue a fresh explicit
  ROOT_RELEASE_UNIFIED76. Full14-phase finite-PATH compatibility is untested and
  must be discovered without permission widening. Current live maintenance below
  does not enter that fixed candidate.

### 2026-08-28T09:04Z — Maintained standalone admission repair, metadata only

- Source96ed7733 resolves seven tracked but unclassified `.mts` inputs: two
  version-bound timeout F22 inputs, four sealed XAN review/compiler inputs and
  one maintained WebDAV public declaration consumer. The original seven bytes
  remain. Six frozen roles bind source/package/owning seals; WebDAV gets an
  unchanged strict type-only route. A new maintained timeout counterpart keeps
  the original options assertions with only the public import specifier changed.
- The current census grows192→200 (199 existing paths plus the new counterpart):
  153 frozen-evidence,36 current,7 declaration,1 frozen-oracle,3 negative-types.
  All192 previous entries and existing negative routes remain unchanged. The
  actual metadata admission and15 read-only checks pass; no compiler/build/global
  tests or XAN execution ran. Strict consumer compilation remains pending. Exact
  paths, roles, original failure and controls are in
  `tests/plugins/qualified-current-release/inventory-maintenance-20260828/REPORT.md`.
  Fixed76 retains192 and is not rescored. AGENTS already states the durable
  classification/history rules; no timeline/count rules were added there.

### 2026-08-28T09:04Z — Current accepted components versus author-only work

- CD464 acceptance2585f78d/192ab78b and LETc26892c3 acceptance08b05531 remain
  scoped, not a current whole-product gate. LET's original81/84 stays separate
  from three versioned checks; original set-u remains unsupported, and the new
  absent-variable check covers the `let` builtin's default zero only. Prior detailed CD/L24,
  invariant-role and mutant qualifications above remain authoritative.
- Noncollecting jq length74361026/independent16c4502d includes the additive
  full846 README package proof6d5cf6c6, recipe4e4fbb56, packff230f2e9079cc843198533e412f836abb62e4ade63f4fa210b7269f7deb4eff.
  Common845 bytes/modes stay exact; no new behavioral replay or automatic live
  composition claim. The old README-omitting projection remains qualified.
- Timeout/curl/actualSafeJS acceptance composes original144e0fca11/12 per layout
  with W05-only01b8e0e7 one per layout, not a rescore. Original24 wrapper
  invocations cover7 programs across layouts,12 successful/12 expected rejects;
  W05 continuation has0 guest evaluations. Actual-engine/private guards and
  native/provider/full-gate limitations remain separate.
- Stack3e4cd743/evidence92b60355 is AUTHOR-ONLY under Locke review. Its selected
  composition and author results are not independent acceptance or fixedf5
  changes. YQ35da1854/evidenceef6032b2/handoffbcec1ead is AUTHOR-ONLY under Sagan
  review, without root/default wiring. No implementation or validation of either
  module was performed by this maintenance task.
- XAN remains execution-held, unaccepted and unregistered. Artifact-only88608b65
  adds30 diagnostic-data/976 counterexample-data controls,0 product executions;
  all195 original nonpass rows/161 obligation mappings remain unqualified.
  F11 annotations are adapter static arithmetic, not telemetry. No retry,
  rephrasing, alternate executor/agent bypass or inferred OS-denial/security
  claim is authorized by classification or documentation.

### 2026-08-28T09:24Z — One fresh-root-authorized fixed76 attempt, setup EPERM

- Fresh root authorization8e6b40ec bound accepted packetd9dd698a, driverreview
  97c081ec and metadatareview7fd7c7ae. Actual receiptSHA
  f29a198d05e113a2a0b913a57bd7a2b088a7f731d6121947527652c40d2b8e74 passed the
  real release guard; exactly one CLI --run issued for unchangedf5/fe15/c109.
  No inherited GO, retry, permission widening or mutable overlay occurred.
- Terminal exit1/HOLD_OR_QUALIFIED_RED: `spawnSync git EPERM` at frozen support
  `combined-8670ebe8/prerequisites.mjs:22`, called by launcher execute.mjs:73.
  The helper accepts the supplied environment but omits it from this Git spawn;
  the verified local finite PATH is therefore not used by that call. Read-only
  source diagnosis only; the failed absolute Git path was not dynamically
  observed and no repair was made.
- Mandatory51 native identities/tools admitted; logical37,397/physical37,392
  candidate projection and452,090,184 opaque-history bytes were recorded. The
  run stopped before the setup sentinel: **0/14 phases,0 builds, no canonical
  counts or package rebuild**. Internal fullGateLaunched:false means no phase
  cohort, not no actual CLI invocation. Old whole-suite/scoped scores unchanged.
- Worker naturally closed with no signals/survivors; aggregate fence/phase
  cleanliness remains false because expected phases were absent. Private264-file
  metadata admission occurred, but no privateState/pre-post proof, engine copy
  or guest execution. Seven raw files/19,036,819 bytes are preserved losslessly;
  exact failed-attempt roots retained. See
  `tests/integration/full-gate-20260827/unified76-driver/released-run-v1/HANDOFF.md`.
  New routing repair/review and fresh root authorization would be needed before
  any further launch; this failed attempt grants none.

### 2026-08-28T10:47Z — Accepted scoped inherited routes; fresh packet pending release

- ROOT accepts qualified independent5bec6231de149d00ae707bfc0ca914d6ee6e1e0a,
  preseal13c50ab58b76423e53f0e49da859dff584343fe9, for source02a50600 and
  reseal96daebc0. New14/14 comprises two E10 obligations, two separate adapter
  cases and ten other controls; it is not14 new product cases. Two actual
  shipping-fenced bare-Git reads and coordinator exit0 have pre-dispatch route
  resolution/outcome evidence, not a kernel exec trace.
- Original99684045 remains30PASS/2harnessFAIL/1UNEXECUTED. E03.3 all-nonempty
  ambient Git restoration remains unsupported; separate admission-refusal and
  present-empty restoration controls do not fill that case. Real prerequisites/
  privateState callsites are source proof only. PriorA10/protection/package
  evidence is carried where byte-identical, not freshly rerun. Original EPERM
  target remains UNKNOWN; consumed8e6b/faileddf89 and its retained0/14 attempt
  remain unchanged, with no new GO or rescore.
- New packet52e83606dc41297a20cbeb3e0fc4ecf703bb242d binds fixed
  f5e9fc49b6abb38e180cc9de16c95fced102ff75/c109 expected package, all38 shipping
  files,17 review artifacts and unchanged profile/routes/tool/projection data.
  Exactly35 shipping members are unchanged from fe15; DRIVER/execute/tool-routing
  are newly reviewed. Normalized driver
  2db94b8bf54405e5713b103bd677c873fcc0b153454b3deed13ee8ab4e90583e;
  normalized packet6cc921ca044fed1b84546bb824f1ab7fc545119c7a5f8ecefd272b23dcd61195.
  See `tests/integration/full-gate-20260827/unified76-driver/release-packet-v3-inherited-routes/LAUNCH.md`.
- The template is deliberately invalid pending fresh metadata review/root release.
  Metadata binding/argument/template-rejection checks only: no new archive,
  instruction materialization, tool probe, private access, product build/package,
  test cohort or gate. Native51/632canonical/192classification/256cleanup and all
  old bounds/guards remain for a future authorized run, not current inferred proof.
  Future output/receipt paths are distinct from the failed attempt and were not
  created. Current live features do not enter fixedf5.

### 2026-08-28T10:47Z — ROOT accepts qualified stack composition; other work separate

- ROOT accepts stack3e4cd743f1d4d2302b6b58a337740b3fde68462a through independent
  0fe2274a28f251370e9894cf30bb215f80b600d0 plus additive
  1446a7063825864290734b4aae25c3ec13cd85e3:136 qualified obligations, C06 still
  partial, original S13 unsupported. This is NOT138/138 or an old-result rescore.
  Original111passes/27assertionfailures per layout and28 separately corrected
  inputs remain distinct. `/bin/sh` shebang remains unsupported; the separate
  `/bin/bash` supplement does not change it.
- Exact composed tree099455f232870fa1ea59e1a0ae482e003fd170db uses CD+LET base
  3e3a2fe381e11540213285e14e2a9a55a72bdbdd with runtime blob
  9ff4aa32354f15901ed18e7e57aa30f812d34b14 and shell blob
  0ebf7efa77df77707d594fa55c89af4db891ee87. Independent full846-member package
  15aa8d8dd6e78a9b7d12156ea2adaf93bd5f0037f13443e8928268c9d5215a18 and actual
  source/installed/moved layouts load207 product modules per case. This entry
  records accepted evidence, not another build or execution.
- Additive C06 has six actual public subcontrols. Its genuinely escaping-control
  versus local-selection portion remains an authenticated source-only ordering
  proof, not a completed public schedule. No dynamic private counter, native,
  SafeJS or global-gate claim follows. Evidence:
  `tests/shell/directory-stack-independent-20260828/review-3e4cd743/HANDOFF.md` and
  `tests/shell/directory-stack-independent-20260828/c06-completion-3e4cd743-v1/HANDOFF.md`.
- Current root assignment gives Faraday the dotglob author window in runtime.ts
  and shell.ts only, under root references3771/429766/deced; no dotglob acceptance
  or fixedf5 change is inferred. YQ remains under Sagan review, without new default
  wiring. XAN remains execution-held/unaccepted; artifact-only88608b65 is not
  product execution/telemetry/acceptance and permits no retry or executor bypass.
  No currentHEAD build, export/default, production or foreign fixture edits were
  performed for this maintenance checkpoint. Existing durable AGENTS rules stand.

### 2026-08-28T11:07Z — Fresh fixed76 attempt stops at native authority setup

- Fresh ROOT release for packet52e83606/final review7ecfe453 was sealed in
  c222e17c4cbcc6bcb9da8a77414b90af3c465d88; receipt SHA256
  6c04ed4badd458d74f8d1c8c4dd945e55cdd087b90b7d49f097aa2338fae524d.
  Exactly one shipping `--run` used fixedf5e9fc49, driver2db94b8b and expected
  packagec109, with output `/tmp/full-gate-unified76-f5-scopedenv-20260828-r2`.
  That authorization is consumed. No retry, permission widening or source repair.
- Actual exit1 precedes all14 phases: zero production builds/canonical tests,
  no TAP score and no package reconstruction. Mandatory native chmod2755/6755
  both ran, returned status1 with `Operation not permitted`, and left0644.
  Group20 membership and helper directory normalization were recorded; the
  specific kernel/policy cause is unproved. This is a native prerequisite
  failure, not a virtual-command assertion or another Git spawn error.
- Native51 identity admission passed, distinct from the failed semantic probes.
  The inherited prerequisite adapter restored its environment and was not
  poisoned. Private-state checkpoints, engine-body copy and guest execution
  were not reached. Worker closure was natural with no recorded survivors;
  aggregate phase/fence cleanliness remains false because phases/final sweep
  did not run. No full integrity, private pre/post or kernel-drain claim follows.
- Evidence55db52a45e583017fba50c02ad64bddce2feb251 preserves eight raw files,
  19,061,272 bytes, with SHA256 and compressed round-trip verification. All
  failed roots remain retained. See
  `tests/integration/full-gate-20260827/unified76-driver/released-run-v2/HANDOFF.md`.
  Old consumed8e6b/df89 stays0/14 with its EPERM target UNKNOWN. E03.3 stays
  unsupported; priorA10/protection/package proofs are bound-only, not rerun.
  Current features/XAN are not injected or accepted by this failed fixed76 run.

### 2026-08-28T11:43Z — Prospective historical eligibility author candidate

- ROOT ratifies independent3077ba0295b1064e575d8ff66bde4e83619d9514 optionA:
  exactly NA-2755/NA-6755 are HISTORICAL August28 observations bound to55db52a4,
  UNSUPPORTED_HOST_OPERATION/native parity UNQUALIFIED. They are not fresh
  capabilities, a49/51 semantic score, or automatic classifications of Node,
  directories, symbolic modes or canonical tests. No denied probe is repeated.
- Preseal6b959e54 precedes source/control candidate
  e35d83ca97f6aa4f32b2cb8542f5e711458f6aeb. Evidence149d0fcb records one actual
  Node24.11.1 run:15 DATA/SYNTHETIC groups pass, zero fail/skip/TODO/cancelled.
  Zero real native probes, real setup, private copies, production builds or gate
  phases. Synthetic callbacks do not prove real private behavior. Independent
  freeze17b9249a has40 proposed controls and remains unexecuted by this author.
- Shipping41 bindings preserve fixedf5/c109, all632 canonical bodies/paths,
  192 classifications,256 cleanup and51 identities. New effective profile
  fa6731eec6b41915f3f56affa9cdf29e7352a10e939bb0f1fe1b9d675caa7510 adds only
  historical eligibility to unchanged strict8c9363ea data. Normalized driver
  f192ca9330a440d33e49544e135a04305a48e84ce85858f902860aafa2ccd4f9.
  Aggregate remains nonzero even if all future runtime checks pass. Raw counts,
  unexecuted phases, unsupported obligations and unknown attribution stay separate.
- Source-only capture initially hit Git-show ENOBUFS on large PROFILE bytes;
  no output files or test rerun followed that failure. Bounded tree OIDs/local
  blob hashing completed metadata capture without increasing buffers. Failure
  is disclosed in evidence, not a product/control failure or gate attempt.
  Handoff: `tests/integration/full-gate-20260827/unified76-driver/chmod-eligibility-v1/HANDOFF.md`.
  Different review/new ROOT release are pending. c222/55db stays consumed0/14,
  old EPERM origin UNKNOWN, failed roots unchanged; no inherited GO.

### 2026-08-28T11:43Z — ROOT accepts qualified DOTGLOB composition

- ROOT scoped acceptance: sourced2502aae3c8458e0ac92662f2af07e7f9fc3923a;
  selected tree37ad3f94f9fa07037e61d2bd27a4a4b7cddb4d5e from accepted STACK099455.
  Full846 packageb0544dcb3d0d9b22420932fc86e4d4693377fcc813fde6bde95c8625edc951aa.
  No fixed76 change or new combined78 acceptance follows.
- Original2e2bfa68 preserves102/102 command checks,696/696 unsupported-matrix
  checks,71/72 globs,14/14 state scripts and8/8 overlapping byte checks in each
  of three layouts. Twenty-five non-R24 procedures pass in their declared roles;
  original shared R24 fails before later reconciliation. Original G039/R24
  failures and zero original mutant kills stay unchanged; no26/26 old rescore.
- Additive preseala5193e0e/evidence8fa48028 executes G039-v2 and R24-v2 each3/3,
  eleven actual compiled-artifact mutant kills plus11 restored positives and
  nine fresh guards;40 children reaped/coordinator0. These are not production
  patches. Original5 strict types/20 controls are retained, not rerun or added
  to fresh compatibility counts. Evidence:
  `tests/shell/dotglob-independent-20260828/continuation-evidence-v2/README.md`.
- STACK136/C06partial/S13unsupported remains qualified as before. Runtime
  acceptance does not authorize arrays (design unratified); ROOT will separately
  assign coherent78+DAV/CD/LET/STACK/DOTGLOB/length composition verification.
  YQ/XAN are not integrated or accepted here; XAN execution hold/no retry remains.

### 2026-08-28T12:37Z — H11.2 bounded supervisor author repair

- ROOT authorizes the narrow inherited observer-fault repair after mapping
  77f80adc35877da619ff16881b6155d9bb9d17cb. Independent aea23327 remains
  38PASS/0FAIL/2UNEXECUTED; no real survivor was observed in that source finding.
  Preseal0f41d342 precedes sourcef03c260269dfd8ee10666f7fd2560655f8e14a38.
  Shipping changes are only launcher-v3/supervise.mjs and DRIVER reseal.
- Source captures primary/secondary observer and capture failures, including
  null/undefined, without bypassing bounded known-owned teardown. Unknown final
  observability remains explicit/nonclean, not a fake empty survivor result.
  Raw cause identity is in-process only; serialized receipts use typed records.
  Terminal persistence and arbitrary process-tree cleanup are not guaranteed.
- First author execution passed13/13 whole-module SYNTHETIC groups, then exited1
  before any real child because the harness counted Node's executable and MachO
  inspection records as duplicate tools. Original capture is sealed by b7da0ec2;
  its pre-execution amendment and harness63aae753 select exact EXTERNAL.tools.
  No source/tool/permission change or actual-child retry followed that defect.
- Evidence89c735fc records the remaining3/3 actual harmless owned-child controls
  plus1positive/4negative tool-role controls. Thirteen synthetic passes are
  authenticated carry-forward, not rerun. R01 natural0 is clean; R02 receives
  owned SIGTERM, closes both captures and preserves null/undefined observation
  faults as UNKNOWN/nonclean; R03 natural0 stays UNKNOWN/nonclean after final
  observation faults. All three identities were absent at outer completion,
  outer rescue unused. This is not shipping OS-fence or hard kernel-drain proof.
- Normalized driveraca88337d644351888659e4364f0610da0219eb3697de45fa808b509bfbc3424
  binds41 shipping files. Effective historical eligibility profilefa6731ee,
  fixedf5/c109 and all632 canonical paths remain unchanged. No native chmod,
  private copy/checkpoint, setup, build, package or gate ran; failed roots remain.
  Different Dirac H11 review and fresh release are pending. Consumed c222/55db
  and earlier attempts stay0/14; historical unsupported obligations stay nonzero.
- H06.3 ROOT disposition is SOURCEQUALIFIED, actual dual-private-error UNEXECUTED:
  report.error A and report.privateGuardError B are preserved IF terminal save
  succeeds. No durable capture if save fails is promised; no private proof or
  H06 source change. Prior A10/protection results remain bound-only, not rerun.
  Handoff: `tests/integration/full-gate-20260827/unified76-driver/supervisor-fault-v1/HANDOFF.md`.

### 2026-08-28 — ROOT accepts scoped coherent78 composition

- ROOT acceptance633f6c82 binds selected8437e4eda904e1248c25eeef0d9d455b1d251495,
  whole858 package6b5863d51ecd6484b79b7141a2004c04b775f9894d5b80bb016a02ffbefed40e
  (759089 bytes), installed evidence484c1dd7. Reported scope:28 positive
  identities/85 executions including H07 repeat plus3 surrogate refusals;
  36 types,86 reached of214,210 loads,6 controls/1 actual mutant,136 children
  and95 Shells. These are distinct denominators, not a full214-case pass claim.
- Prior822a1528/4024f790 and original16/18 are preserved. This is not currentHEAD,
  whole-gate, native or private integration acceptance. Exact SafeJS follow-up
  is assigned to Locke; fixed76f5/c109 is not rebased by this composition.
- ROOT now authorizes Faraday's first-profile arrays implementation under
  selected37ad; it is not yet an integrated candidate. This updates the earlier
  unratified-design status prospectively without rewriting historical evidence.
  YQ remains under different review; XAN execution hold/unaccepted status remains.

### 2026-08-28 — ROOT accepts H11 scoped independent continuation

- ROOT accepts652b76f4af9a03ba1fe0d8f90ca5128463f9e34b, preseal/audit
  1a5c1dcf44ec7e719e43f4b6f8268bab81a02965. Sourcef03c2602 is unchanged.
  Distinct new results:3 actual fenced owned-child cases,22 comparator controls
  and6 collector checks; coordinator0. All three registered PID/birth/PGID
  identities are absent afterward; outer rescue0/KILL0. A02 uses owned SIGTERM,
  retaining falsy primary/secondary faults with UNKNOWN/nonclean disposition.
- This is whole linked-module/fenced-child proof, not full-phase IPC, private
  or whole-gate proof. Originalfb6f048d15PASS/1harnessFAIL/2UNEXECUTED and505
  artifacts remain unchanged; old15 proofs were not rerun or silently rescored.
  H06.3 stays ROOT SOURCEQUALIFIED/actual dual-private-error UNEXECUTED,
  conditional on successful terminal persistence; save failure has no durable
  capture guarantee. Originalaea23327 remains38PASS/0FAIL/2UNEXECUTED.
  Evidence: `tests/integration/full-gate-20260827/unified76-driver-independent/supervisor-repair-v17/continuation-v2/HANDOFF.md`.
- AGENTS gains only a durable cross-realm tool-role rule: exact finite own-data
  types/keys/values/sequence order rather than prototype identity; reject holes,
  accessors/extras without coercion; preserve real thrown-reason identity and
  strict route admission. No product API or hostile-host sandbox claim follows.

### 2026-08-28T13:31Z — Fresh qualified76 packet prepared, NO release

- Packet69f5cc1b binds normalized
  d236cc7723dfaf860e3e70cda1d04bff2f46950c54c845d8ac0184e969296b00,
  driveraca88337d644351888659e4364f0610da0219eb3697de45fa808b509bfbc3424,
  effective profilefa6731eec6b41915f3f56affa9cdf29e7352a10e939bb0f1fe1b9d675caa7510,
  fixedf5e9fc49/c109 package and41 shipping members. Thirty-nine members are
  unchanged frome35; only supervisor/DRIVER differ. Compared with old52e83606
  shipping,31 stay identical,7 change and3 are added, all explicitly enumerated.
- Exact eligibilityProfile=unified76-historical-file-authority-20260828-v1,
  historicalEligibilitySha256=519ac40f0239bf363586c5144bbe7f0f3c72c786f42abbc2d1d9ffb004ba2cf6,
  acceptsUnqualifiedHistoricalNative=true are required. NA-2755/NA-6755 remain
  HISTORICAL August28 UNSUPPORTED_HOST_OPERATION/native parity UNQUALIFIED;
  admission does not repeat them. Other mandatory checks stay strict. All632
  canonical paths/bodies remain unchanged and eligible, with no skip/filter/
  raw-count deduction. No broad Node/directory/symbolic-mode attribution follows.
- Even if all14 runtime phases qualify, aggregate exit remains1 with
  QUALIFIED_DIAGNOSTIC_UNQUALIFIED_NATIVE, never strict/all-qualified green.
  Missing/failed integrity, cleanup or ordinary evidence remains separately
  HOLD_OR_QUALIFIED_RED; admission can refuse78. Raw Node22/24 gaps and all old
  failures stay separate. Both8e6b/df89 andc222/55db remain consumed0/14.
- Metadata-only checks authenticate41 shipping/35 proof-file bindings, unchanged
  strict profile/projection/routes/cleanup/native identity metadata, fixed Git
  commit/tree/four-fixture data and14 phase/bound constants. One shape-only
  positive plus11 invalid receipt shapes pass; invalid template refuses.
  No actual tool probes, private reads/copies, archives, setup, builds or gate.
  PriorA10/protection/route evidence is bound-only where bytes are unchanged;
  metadata strings do not authenticate their own claims.
- Future output is /tmp/full-gate-unified76-f5-historical-h11-20260828-r3;
  actual authorization path is /tmp/unified76-release-f5-historical-h11-20260828-r3.json.
  Both remain absent. Setup600s/phase1800s/outer25805s/cleanup5s and capture
  256MiBphase/4GiBtotal are unchanged, as are13 supervised phases+final sweep,
  one driver build,51 identities,192 classifications and256 cleanup inputs.
  Dirac metadata review and FRESH ROOT authorization remain required; no GO
  transfers. No product/default/limit/permission changes or failed-root mutation.
  Command and template: `tests/integration/full-gate-20260827/unified76-driver/release-packet-v4-qualified-h11/LAUNCH.md`.

### 2026-08-28T13:52Z — ROOT accepts actual coherent78 SafeJS workflows

- ROOT scoped acceptancef199787165ed3cfba82152cde31c5b794e03fad0 follows grant
  5b4649ddd643a631b7c92b1520a415baa35200be and sole executor activation
  6d7159e35a1cd92b0ede967d3fe428d54a74d4bd. Installed and physically moved
  G01/G02/G03 give six actual engine evaluations, guest entries, bound-context
  bridges and public execs,30 semantic assertions. Six Shells/cleanups settle;
  recorded final resources0. This updates the earlier pending follow-up, not
  the accepted coherent78 or historical guest denominators.
- G01 covers source/function/pipes, stack/CDPATH/dotglob/LET/getopts with status0.
  G02 injected curl reaches body-next before manual deadline; public settlement,
  engine/bridge/disposal/cleanup remain pending while cleanup is held. After
  controlled release, transport cleanup/disposal/bridge/engine/wrapper/invocation
  cleanup precede public status124. G03 guest error/read-only FS/state isolation
  returns expected1. Expected124/1 are workflow outcomes, NOT negative-control
  passes. No new mutant/fault-injection cohort or caller-priority collision.
- Raw engine Error("{}") and bridge [object Object] serialization are retained;
  no actual reason-identity, host-abort-as-retirement or global cleanup guarantee.
  Step10000/shared-shell128 are enforced caps, not separately observed consumed
  units. Run timestamps provide metadata bounds, not a latency measurement.
- Whole858 package6b5863d51ecd6484b79b7141a2004c04b775f9894d5b80bb016a02ffbefed40e
  and installed manifest484c1dd76c63f126376cff810b445c8185e791825ec83fd94e996691b2b1eb5d
  inherit633f6c82 source qualification/selected8437e4ed. Fresh source proof is
  43/268 paths with35 missing descendant trees, NOT full reconstruction or a
  product rebuild. This Node22.22.2/darwin-arm64 cohort is separate from the
  held fixed76 Node24 gate; no currentHEAD composition is inferred.
- Actual enginebb23ec270aaaf1d394b00d330fbf1aa6ccb2952e uses63 regular selected
  source files copied outside private. Each workflow authenticates210 product
  modules,63 engine modules and one compiler module;378 engine emissions match.
  Offline scripts-disabled install observes562 unique npm modules within the
  approved808-file static envelope, NOT a dynamically minimal dependency set.
- All11 direct children naturally settle0,12 processes including supervisor.
  This is bounded owned-child evidence, not a universal process census. Private
  pre/post bounded guards remain equal: src257,refs57,metadata9 plus declared
  tools/references; no private status/index refresh or writes. Other packages,
  dist/node_modules/caches/logs/reflogs/object-store membership/atime/tool-sibling
  additions are outside those guards. No blanket whole-private unchanged claim.
  Twenty-nine original guard records are archived; immediate cleanup checks use
  successful sealed CLOSURE/final hash, not separately retained event records.
- Preserve metadata-only PATH127: a zsh loop variable named path changed that
  inspection's PATH, preventing cat/find; only metadata reads were repeated with
  filename. No executor/import/install/guest ran in the failed inspection.
  Original7600/6d7159 artifacts, historical counts/failures, STACK136/C06partial/
  S13unsupported and composed DOTGLOB qualifications remain. No native oracle,
  external HTTP, broad arrays/YQ/XAN, private approval, full gate or superiority
  claim. One-shot grant is spent; no retry follows this documentation update.
- Report: `tests/integration/coherent78-safejs-independent-20260828/execution-checkpoints/c78-safejs-20260828-01/REPORT.md`.
  The curl README example/current root exports/types were inspected only:
  networkCommands requires authorize, accepts an optional mock/real transport,
  remains opt-in and uses the existing TypeScript ESM zero-runtime-dependency
  package in safe-bash. No implementation, build, runtime test or root wiring
  occurred for this documentation task. Packet69f5cc1b remains pending metadata
  review/FRESH ROOT release; no gate authorization is implied.

### 2026-08-28T14:06Z — Qualified H11 attempt consumed, 6/14 integrity HOLD

- Fresh ROOT grant ROOT-2026-08-28-UNIFIED76-QUALIFIED-H11-R3-ONE-ATTEMPT was
  committed021302a1 after metadata acceptancee5ed3ecb. Exact1333-byte receipt
  SHA256f61bace1ea85dc1aa19b8f80728cbc4526148fbca424ac452a818471c28dc847
  preceded the single prescribed --run/session93642. Packet69f5cc1b/fixedf5,
  driveraca88337/effective profilefa6731ee stayed bound. No retry, wider route,
  permission change or live product overlay occurred. This grant is CONSUMED.
- Inner start13:57:13.485Z, finish14:06:52.855Z; terminal exit1 is
  HOLD_OR_QUALIFIED_RED, not all-runtime-qualified/native-unqualified completion.
  Six phases executed: availability0, cold types expected78, typecheck:all0,
  benchmark-types1, env-source-binding0, canonical1. One driver production build
  is recorded. Benchmark checker never started: build-audit.mjs cannot resolve
  frozen source/benchmarks/node_modules/typescript. No workaround was applied.
- Canonical raw TAP:19425pass/132fail/7skip/0TODO/0cancelled,19564 test instances.
  Source-bound offline parsing reconciles the captured footer after exit; the
  original inner report did not reach canonical accounting after integrity halt.
  This is not a new run, verdict replacement, zero-skip qualification or proof
  all632 selected paths executed. Full raw TAP/load traces remain preserved.
- Post-canonical source immutability rejects286 added entries:71 table-text
  .native-* roots with left/right/sentinel (284 entries), plus
  tests/commands/table-text-stress/shared-stdin-fix/.runtime and
  tests/fs/mount/identity-authority-review/implementation/.runs. Dependent work
  stops. Current-consumers/pack/public-runtime/public-types/negative-types/
  missing-root/missing-contracts/final-sweep remain NOT_EXECUTED (8/14).
  No added paths were removed, old roots resumed or fixtures repaired.
- Failure routing, not root-cause verdict: diff-patch77, shell33, expr6,
  metadata5, search7, stream-inspection1, RealFS1, S3 HTTP export-consumer1,
  maintained native-data fixture1. Exact132 names/paths/details and all seven
  skip strings are in TAP-NONPASSING.json. Native EPERM/socket EINVAL/Node22-vs24
  characterizations remain raw, not automatically product bugs or deductions
  against historical NA-2755/NA-6755. Those two admission probes were not repeated.
- All six phase receipts and outer worker record closed/clean process lifecycles,
  zero supervisor faults/signals/recorded survivors; observer survivors empty.
  Aggregate fence cleanliness and bindingComplete/guardsPassed/cleanupComplete
  are false because the attempt is incomplete and source integrity fails. Outer
  also records 'inner driver binding or verdict failed'; nothing is suppressed.
  These receipts do not certify arbitrary descendants or kernel-hard cleanup.
- Nine maintained setup stages completed; exact five candidate plus one
  benchmark instruction metadata omissions remain. Captured private HEADbb23,
  264 staged regular engine-package files, privateUnchanged=true and no recorded
  changed files are existing guard results only, not a new private inspection
  or whole-private certification. No private refresh/read/copy occurred during
  post-run evidence analysis. H06 dual-private-error remains UNEXECUTED and
  terminal-persistence conditional; no fault-injection extension is inferred.
- Evidencec23a8de8 preserves928 regular output/outer files:114734734 raw bytes,
  11430146 gzip bytes with raw/encoded SHA256, modes, gzip roundtrips and matching
  capture pre/post inventories/bytes. Original output, outer and temporary source
  remain retained; the source tree was not recopied into evidence. Author capture
  code is post-terminal data processing, not an independent/pre-code experiment.
  Handoff: `tests/integration/full-gate-20260827/unified76-driver/released-run-v3-qualified-h11/HANDOFF.md`.
- Prior8e6b/df89 andc222/55db remain consumed0/14. New021302a1 is consumed6/14;
  no strict/full-release/currentHEAD/native parity/superiority acceptance. Further
  diagnosis, repairs and execution require separate ROOT authority; no GO remains.

## 2026-08-28 — R3 diagnosis and bounded author harness repairs

- Diagnosiscd9d08be and independent682aad12 reconcile all132 failures and7 skips
  without deductions. The original canonical phase row contains accounting;
  the later top-level canonical assignment was not reached after integrity failure.
  R3/c23a8de8/55d9bb1a remain19425P/132F/7skip,6/14, unqualified integrity/cleanup.
- ROOT authorized proven fixture/route repairs only. Preseald627747d,
  source437778996f60109e212e20b1b242455866fda285 changes13 fixture/helper files
  plus shippingexecute/DRIVER, no product bytes. It fixes owned scratch lifetime,
  explicit admitted rootTS/Git/npm selection, missing native TMPDIR routing and
  two explicit TAP reporters. Native effect equivalence remains unexecuted.
- Controlsealb7e7689b:45/45 synthetic/source checks,17 stub dispatches,
  zero actual native/product/private/build/gate execution. Shared version positive,
  auxiliary native flow, S3 later package flow and compiler success are not proved.
  Five pipeline tools lack admitted closure; unresolved signal/mode/socket/env-S
  expectations and all seven skips remain unchanged. No permission widening/GO.
  Handoff: `tests/integration/full-gate-20260827/unified76-driver/r3-repair-v1/HANDOFF.md`.
- ROOT separately accepts mapfile observer3d3a0371 through Locke review d60df2ed:
  55/55 synthetic/source only, original47/49 retained; zero real observer/native43/
  product executions. Real-process qualification is preparation, no GO or mapfile
  implementation. Declaration P1–P4 ratification7719f39e has no implementation GO;
  arrayS06 successorc0adae53 remains author-only awaiting complete independent review.
  Curl confirmationb795 remains unchanged. None of these enter fixedf5 or this repair.

## 2026-08-28 — User-priority command inventory, source/data only

- Exact user counts/shares and “without the npm stuff” are preserved in
  `docs/COMMAND_PRIORITIES.md` / `.json` as USER-PROVIDED, not verified statistics.
  Exclusion is npm/npx product commands only; requested node and prior curl remain.
  Development npm/Node/TypeScript/oracle dependencies are unchanged.
- Actual registration/source inspection: ten requested defaults (sed,rg,printf,nl,
  cat,head,echo,find,tail,ls), optional curl; product git,node,apply_patch missing.
  SafeJS is not Node; diff/patch and the agent's patch tool are not apply_patch.
  Report records source start lines, real subsets, gaps and scoped evidence, not
  name-count parity. Recommended next absent tool is a bounded genuine read-only
  VFS Git reader, with explicit format limits and independent review before wiring;
  no implementation grant or host-Git fallback is implied.
- Observed HEAD00bb4765459176dafc4b5c77fc97d2630c46a689;14 selected current
  command/registration files match the authenticated268-input table of accepted
  coherent78/8437e4eda904e1248c25eeef0d9d455b1d251495, proof633f6c82/full858
  pack6b5863d5. Current runtime.ts differs. Metadata comparison is not reconstruction,
  a full dependency closure, new flag execution or current whole-runtime acceptance.
  Existing source search README's host-glob paragraph is stale against the current
  worker-dispatched glob source; no module source/document changes made here.
- AGENTS adds only durable priority/exclusion distinctions; README links the audit.
  No product/native/compiler/build/private/gate execution, dependency/export change,
  historical expectation rewrite or foreign artifact staging/cleanup. R3 remains
  19425P/132F/7skip,6/14 with integrity/cleanup false; no new GO or superiority claim.

## 2026-08-28 — ROOT qualified ARRAY acceptance; selected DOTGLOB77 only

- ROOT accepts the qualified synthesis2037895f0da461176001940b6745e9acd2ea94ca:
  candidatec0adae539c736db0e4023d401562ce958d9ebb00, selected tree
  30f88590b66b88dc9694a56c85f1ee690f02218b, full862-member pack SHA256
  e12ed19882b6722503a8fb962ca88e0d6c40300a7e76acc3f81aef5961e0a3a3,
  ONLY on accepted DOTGLOB37ad3f94f9fa07037e61d2bd27a4a4b7cddb4d5e/77 defaults.
  Evidence: `tests/shell/indexed-arrays-independent-20260828/s06-successor-v1/final-synthesis-v1/README.md`
  and `PROOF-MAP.json`. The report's recommendation is now ROOT-accepted within
  this scope, not current HEAD, coherent78-plus-arrays or a whole-product gate.
- Proof composes original14179c5e raw evidence with versioned5fafd41c tail:
  33 semantic,22 mechanical,16 holdout and P01–P10 obligations, four AST inputs,
  and10 strict type cases across three layouts are mapped. Mixed/source/overlap
  mappings are NOT a sum of independent behavioral passes. M21 is SOURCE ONLY;
  M03/M07/M14/M15/M20 are MIXED. M22 escaping is BRIDGE_CAPTURE: the exact private
  rejection is captured and public exec fulfills0, not global public escaping
  rejection proof. P04 aliases M22; P03/M17 and P05/M08 also overlap.
- Twelve unique U01–U12 mutation families comprise eight old
  (U01–U07,U10) plus four new (U08,U09,U11,U12), with a separate S06 reversion.
  Original10/9/8 remains unchanged. U11 has its pre-mutation mixed control;
  restored-after is P06, not a new post-mutation P11 run. Four-input AST proof
  and211 nonprivate declaration comparisons are versus old-c7 only, not exhaustive
  pre-array DOTGLOB compatibility. Cloning/serialization/cross-package or duplicate
  module WeakMap metadata transfer remain unproved; no WeakMap GC/RSS guarantee.
- Original14179 HOLD, all harness/report-helper failures and540 losslessly
  archived raw records remain. ROOT's cleanup recordb507852d removed ONLY437
  duplicate raw files/116980358 bytes after lossless archive verification;
  other75310015 bytes plus new tail raw remain, and both owned staging roots
  remain retained/untracked. This documentation task removed nothing and does
  not independently recertify a later live-directory census. No historical rescore.
- Profile gaps remain explicit: associative/computed/negative-index arrays,
  indexed parameter operators, nameref/declare/mapfile integration and arithmetic
  fallback are outside the ratified first profile. STACK136-qualified/C06-partial/
  S13-unsupported qualifications are inherited, not expanded by this acceptance.

## 2026-08-28 — Priority module candidates and M1B design remain unaccepted

- Git M1A9885390fb11454fa194a3e60fdbef198dbfdf633 is under Dirac independent
  review. Its author full898-member pack is
  68541722217fb3f88f7317750c8f1a66042ea090f2c769564b9afc14372dfe68 on selected
  coherent78 plus11 module files; no accepted public/default Git integration or
  ordinary packed-repository support. Author handoff:
  `tests/commands/git-author-20260828/HANDOFF.md`.
- ROOT reports apply_patch module candidate58be882 pending independent review.
  Current leaf factories exist in `src/commands/apply-patch/index.ts`; recording
  the supplied candidate shorthand is not a new stored-object/full-package proof
  (development Git lookup did not resolve that shorthand in this checkout).
  Node CommonJS contract/provider remain unqualified. Defaults78/root APIs stay
  unchanged; curl/SafeJS remain opt-in and are not substitutes for these commands.
- M1B design/data63d811bf1a809b467f47f309f41b1445486e71db is under Sagan
  independent design review; no implementation GO. Its thirteen valid-format DATA
  sets include one out-of-profile depth33, plus18 specified malformed-data refusals;
  these are not product/native passes. D1 eager verification/D2 inert-sidecar
  allowlist/D3 pinned-cache policy remain proposed. Original B01–B12/24 fixed caps,
  M1A source and all historical failures are preserved.
- README and COMMAND_PRIORITIES distinguish the original missing-command audit
  from these later candidates; exact user counts/shares remain USER-PROVIDED.
  AGENTS already contains the applicable durable scope/evidence rules and is
  unchanged. Docs-only checkpoint: no product/native/compiler/build/private/gate
  execution, source/export/default changes, retained-root cleanup or new gate GO.

## 2026-08-28 — ROOT-qualified coherent78 + accepted-arrays composition

- ROOT accepts exact composition `d111e5bf1f53aff16c5d4112e9ead2e025d6464f`,
  full874-member/795138-byte tar SHA256
  `f5152eaeaaeb78aff350a86d55f67905c2caab900ba2f45b1869da6498e1e956`.
  Basis: author `b9039b80ebf4c7f454a0614871d7b03b1aeaaf1d`, independent original
  `560394bb2df7ca2504ff9de965fc78f360da3746`, and versioned F11-v2
  `4c8aa40747e05409e4afd49062285a47525c430b` after preseal
  `b6a8ee3b76ba4aafb8a5abe981aa041906f38ceb`. Evidence:
  `tests/integration/coherent78-arrays-independent-20260828/REPORT.md` and
  `tests/integration/coherent78-arrays-independent-20260828/f11-v2/REPORT.md`.
- This composes accepted coherent78 base
  `8437e4eda904e1248c25eeef0d9d455b1d251495` with accepted array source
  `c0adae539c736db0e4023d401562ce958d9ebb00`, selected
  `30f88590b66b88dc9694a56c85f1ee690f02218b`. All272 selected inputs are bound;
  ONLY `src/shell/parser.ts`, `src/shell/runtime.ts` and
  `src/shell/arrays/{bindings,ledger,state,syntax}.ts` override the base.
  `shell.ts`, root APIs/exports, package configuration and defaults78 stay
  unchanged. This is neither whole-HEAD acceptance nor a full repository gate.
- Across source-build emissions, actual installed and physically moved layouts:
  93 retained author outcomes (including three refusal controls),72 corrected
  novel outcomes comprising69 original novel passes plus3 F11-v2 passes,
  30 strict type outcomes,7 admission/fallback refusals,2 actually loaded and
  activated mutant kills, and4 restored positives. The original two passing
  mutant companions remain separate; these categories are not a new summed
  denominator or a replay of the underlying array mechanical proof.
- Original560394bb remains exit1/HOLD with69/72 novel outcomes and three F11
  failures. Its fixture omitted the virtual `/dev` parent, so redirects failed
  before cd/pushd/popd; expected stdout was not changed. F11-v2 adds ONLY that
  virtual directory and passes3/3 with exact `/search/project|stable\n`, empty
  stderr/status0. A separate original-worker negative reproduces `/w|stable\n`,
  three exact missing-/dev/null diagnostics, product status0 and failing worker
  status1. It is not a fourth novel positive or a rescore of the original failures.
  `/dev/null` here is an ordinary VFS output path, not new special-device support.
- Original independent review freshly reproduced the exact full package;
  F11-v2 reused and reauthenticated it without build/compiler/install. The tail
  closed4/4 children in11.395 seconds at terminal publication, with263243 captured
  bytes and15989049 bytes of new retained work. All109 original archives/raw
  receipts remain unchanged;13 additional receipts were losslessly archived.
  Old and new owned staging remain retained/untracked. This docs-only record
  performs no new runtime execution or cleanup and does not claim a fresh census.
- Retained array qualifications: M21 SOURCE ONLY; M03/M07/M14/M15/M20 MIXED;
  M22 BRIDGE_CAPTURE with public fulfillment0, not global escaping-rejection
  proof; P04 aliases M22. Existing four-input AST/211 declaration comparison was
  against old-c7 only. Metadata serialization, cloning and cross-package/duplicate
  module sharing remain unproved. E/input and post-transfer command formatting
  remain outside the private array ledger; no combined-memory/RSS, global-resource
  or hard/universal-preemption guarantee. STACK136-qualified/C06-partial/
  S13-unsupported and other accepted first-profile exclusions remain unchanged.
- Command priorities are not promoted by this composition: Git and apply_patch
  module candidates remain pending independent review/public integration; Node
  remains provider/contract design, not qualified Node compatibility. Curl stays
  opt-in, SafeJS is not a substitute for Node, and npm/npx product commands remain
  excluded. No actual SafeJS/private-engine, native-oracle, external-service,
  superiority or global-gate claim follows from this acceptance.

## 2026-08-28 — ROOT-qualified Git M1A module; type exit convention adjudicated

- ROOT qualifies module source `9885390fb11454fa194a3e60fdbef198dbfdf633`
  on original derived base `8437e4eda904e1248c25eeef0d9d455b1d251495`,
  full898-member package SHA256
  `68541722217fb3f88f7317750c8f1a66042ea090f2c769564b9afc14372dfe68`.
  This is the frozen M1A composition, not moving HEAD, later M1B or public/default
  integration. Curie retains the separate future integration decision; defaults78
  and root exports are unchanged by this record.
- Evidence `b94bd13b156320d713d692c11f85f655cda68690` retains284 unmodified
  semantic passes:71 each source/compiled/actual offline-installed/moved, matching
  observations. Strict build and full-package installation bindings passed.
  Three loaded mutants were detected, three fresh-child restores passed and three
  binding controls refused. These denominators remain separate and are not rerun.
- Four original intended type properties passed. The fifth, missing-root-export,
  is supported separately by actual v14 exact TS2724 at line1/column9 naming
  `createGitCommand`, its sealed `createTarCommand` suggestion/related information,
  no extra diagnostics, identical consumer bytes and actual nonzero exit1.
  ROOT adjudicates that exit1 as the intended rejection: the inherited API wrapper
  maps all diagnostics to1, whereas its expected2 came from the CLI convention.
  This is not an aggregate5/5 claim or a rewritten test verdict.
- Original v12 overallHOLD/types4-of-5, v13 positive-wrapper failure/negativeUNRUN,
  and v14 raw negativeFAIL/overallSCOPED_FAILURES/exit1 remain immutable. The v13
  unsupported `emitSkipped` assertion and secondary empty-JSON failure are retained.
  V14 observed `emitSkipped:false` without using it as acceptance; exact negative
  diagnostics were independently compared as DATA after the exit assertion failed.
  No compiler retry, changed historical exit or product fix accompanies adjudication.
- Actual per-layout295 closed/destroyed/close-delivered stream objects and167
  fulfilled registrations remain distinct from SOURCE_LINKED_CONDITIONAL_JOIN
  private-writer proof. No private-Promise timestamp, native allocation/RSS bound,
  universal late-error/opaque-host preemption or hostile-host guarantee follows.
  Untaken fallback/listener branches retain SOURCE-only qualifications. The frozen
  bounded read-only profile supports SHA1 loose objects/indexes and packed-refs,
  but refuses pack/idx/promisor and other unsupported storage/configuration forms;
  text-diff/ignore/pathspec/rendering subsets, provider metadata and nontransactional
  race/partial-output limitations remain. Native Git6 workflows are still unrun.
- SOURCE/DATA-only adjudication authenticates evidence
  `7dfde40f453b03d34fdc976eab1d36188c533aa6`, exact raw negative SHA256
  `eae2b77fc0d8aec5aad8fb90eafb5ecf90d935e1530e07d2f0f82f25c95640c3`,
  wrapper literal exit mapping, pinned TypeScript5.9.3/Node22.22.2/options and the
  recorded no-output/source/FS integrity guards. No new case, compiler, build,
  install, runtime, private-engine, native-oracle, network or cleanup is executed.
  Full bindings and limitations:
  `tests/commands/git-independent-20260828/m1a-type-adjudication-v15/TYPE-ADJUDICATION.md`.

## 2026-08-28 — ROOT-qualified priority workflows; RUN02 closed

- ROOT accepts scoped actual evidence
  `0a942ed29897a1993ab45e0b374c5d9edd829682` and finalization
  `4cb1745d381a98f83c030f3e7cad0072179e43ad`, authorized before execution by
  `96c0fb58664ce8ab8044f31acdbbaa4fcc9cf486`. Exact selected composition
  `8437e4eda904e1248c25eeef0d9d455b1d251495` binds268 source inputs and the
  full858-member package SHA256
  `6b5863d51ecd6484b79b7141a2004c04b775f9894d5b80bb016a02ffbefed40e`.
- Original source P01-P15 passes plus RUN02's78 passes complete the finite
  31-case × three-layout membership: source31, installed31, moved31.
  RUN02 executed source16/installed31/moved31 once, with0 failures,0 STOPs and
  0 unrun in its selected78. This is a versioned synthesis, not a fresh93-call
  execution or a rescore of RUN01's P16 STOP/77 unrun. Original RUN01's15 passes,
  four withheld and aggregate UNKNOWN remain immutable; source P01-P15 were not
  replayed. P16's later pass uses the approved exact child-stage trace contract.
- RUN02 setup3 and admission4 remain separate from78 public calls. All85 direct
  children plus the supervisor and63 product Workers actually retired, with
  fulfilled product termination and no emergency/unknown RUN02 retirement.
  The82 Node-managed loader requests are not independent loader-exit receipts.
  Actual parent/Worker membership and entry bytes were observed separately.
  Post-run selected/emitted/full858-moved/tool/seal bindings remained exact.
- Charged capture6124037 bytes comprises347955 stdout/stderr plus5776082 log
  bytes. Retained scratch200067167 bytes includes the fixed16MiB terminal:
  8210629 JSON+LF bytes plus8566587 padding spaces, not truncated evidence.
  These are logical observations, not RSS/whole-invocation-memory/global OS
  quotas, transparent instrumentation or hard post-SIGKILL/opaque-work guarantees.
  Earlier preparation unknown resource history is not retroactively accepted.
- ROOT closes RUN02 to all future consumption. Retain children0, Worker
  starts249, loader roles0, capture350391803 and scratch336803745 bytes, without
  release/reuse. RUN01 remains closed with children77, Worker starts353,
  loader roles77, capture418174207 and scratch347730492 bytes, four withheld
  and aggregate UNKNOWN. No refund, balance rewrite, old-raw cleanup or new
  execution accompanies this documentation/closure record.
- The existing78 defaults, TypeScript and zero runtime dependencies remain;
  curl stays opt-in. This proof adds no arrays, Git, apply_patch, Node, YQ or XAN
  acceptance. Git M1A9885390fb11454fa194a3e60fdbef198dbfdf633 is separately
  accepted module-only, not public/default; M1Bfca6f81d2d96db2bbceabf3247cd57ffe240bde6
  and ROOT-reported apply candidate753 await review; Node scaffold/provider remain
  pending. No overall just-bash win, fresh global type gate or release follows.
- Exact authority, finite membership, both retained reservations and qualifiers:
  `tests/integration/priority-command-workflows-20260828/npm-pin-rebinding-v2/p16-trace-repair-v4/actual-run02-v1/ROOT-ACCEPTANCE-AND-CLOSURE.md`.

## 2026-08-29 — apply_patch79 public author composition, review pending

- ROOT-qualified module753f33d2fa1a2ccd86089c563d4ad66b9a1ae26d/full882
  f04afbf9230fd9e3275f83c7dab26837aeb618bd6178f4ac0b794b93302d6d95 is accepted
  under c1fc3ee8a010289145959a05e8b088e51f21780a. Original L07's7/9 and its two
  cleanup-count assertion failures remain unchanged: two separate cleanup owners
  fulfilled, not the fixture's expected one. Legacy11 failures and21 uncredited
  observations retain their source/backend/resource qualifications.
- Root integration83730c6085597d8480a25aa639793582984eebd0 adds only apply_patch
  as default79, root/explicit commands/apply-patch exports and aggregate applyPatch
  limits with top-level replacement authority. Module six-file bytes unchanged;
  base is accepted coherent78+arrays d111e5bf, not current HEAD. Curl/SafeJS stay
  opt-in; Git/YQ/XAN/Node/declare/mapfile are not registered. Zero runtime deps.
- Executed derived e83d6c481e3c17b56fe32a17593628d8d7c820a9 has278 selected
  build inputs; actual full898 package
  643939eb315c4869de456bb24e371257e3d85b442f3ca401c57ae93c631c7edd (814632 bytes).
  One strict build/offline install/physical move; new public27/28 each layout,
  arrays12/12 each, selected coherence18/18 each, six type groups and six controls.
  Maintained four-file bodies82/83; moved stream consumer21/21. No global gate.
- Four assertion failures are preserved. P05's three failures compare a registered
  frozen copy with its input object; the maintained failure omits apply_patch from
  one literal name tail. Exact fixture correction6bcb5561 is committed but UNRUN.
  Fixture-only derived successor7fde32264d757ef856acf3ae92c8581b4a294341 retains
  every278 build input and the exact already-built package; no rebuild/rescore.
  Different public integration review is still required; original author run is
  AUTHOR_ASSERTION_FAILURES, not passing acceptance.
- All28 direct children closed naturally,0 signals;36.678s/2,964,466 child capture
  bytes/66,273,312 scratch bytes. These do not establish global Worker/native/RSS
  closure. No native, private engine, network or module implementation execution
  outside the selected authorized author profile. No AGENTS rules changed.
- Exact source/package/types/failure/qualification handoff:
  `tests/integration/apply-patch-public-20260829/HANDOFF.md`; raw captures immutable.

## 2026-08-29 — Qualified public79 baseline and Git80 author integration

- ROOT accepts public79 through bd772916c26dc87c54bafdaa784d18f058efa275 on
  exact7fde32264d757ef856acf3ae92c8581b4a294341/full898643939eb. The different
  review's225 outcomes and six type groups are scoped; its maintained79/83 exit1
  retains four RegexWorker-denied unqualified rows, not proven product failures
  or83/83 passes. Original author27/28×3 and82/83 remain unchanged.
- ROOT-qualified M1B fca6f81d2d96db2bbceabf3247cd57ffe240bde6 is consolidated in
  db8b818db983f32c9522ebe4c9589ca8766a5454:274 finite identities split208 stock,
  32 mechanical,10 types,24 loaded. S01's18 mechanics/three loaded roles are
  separate; S02/H09/private-writer SOURCE gaps, native6 UNRUN, old bare-OID and
  deadline failures, nonexhaustive maps and strict eager practical caps remain.
- New root integration319c0ae2f5e3decb3fced2280c6db004d0e7eb9b adds Git as
  default80 with root/explicit commands/git APIs and aggregate discoveryBoundary;
  top-level replacement is authoritative. All24 limits and all14 accepted module
  files are unchanged. No runtime dependencies, native fallback or new Node/YQ/
  XAN/declare/mapfile commands. Curl/SafeJS remain opt-in. No AGENTS rule changes.
- Exact author selected treec83f352f057c64917f219eb938f54aa42cdab829 has292
  build inputs:fixed79 plus14 Git files and only four root/package/README
  replacements. Five maintained inventory files are prospectively versioned,
  not historical fixed profiles. Preseal fed8df60, binding f23aecb8; one actual
  selected build/offline pack/install/physical move, never a rawHEAD build.
- Actual950-member package4671ed60875c87f8cc32b735fde5d9b57301f427ecd5a376ad1123afb951e156
  is864000 bytes:52 emitted Git members added,10 root/plugin/metadata members
  changed,888 common members identical,0 removed. Each source/installed/moved
  layout passes new public45/45, apply28/28, packs93/93, arrays12/12 and selected
  coherence18/18. M1A is139/140 each:three preserved obsolete module-only export
  assertions, not a proven Git query bug. Terminal AUTHOR_ASSERTION_FAILURES.
- All six strict type groups pass their defined outcomes:three positive and
  three negative with18 actual diagnostics;90 declarations authenticated/group.
  Maintained four-file bodies83/83 under the admitted exact RegexWorker profile,
  moved stream21/21. This new execution does not rescore the79 worker-deny profile.
  One loaded registration mutant killed, exact restore passes, four binding
  refusals succeed. These controls do not establish universal resource parity.
-37 direct children closed/0 OS signals;4 observed RegexWorker create/exit pairs
  and26 conservative loader reservations total67<=80. Worker exit1 reflects
  library retirement; no worker-internal import/kernel/native-resource census.
  Actual39.556s,3,083,451 captured child bytes,71,345,567 scratch bytes. Source,
  dist and whole installed/moved inventories pass pre/post guards. Raw175
  descriptors and full package are preserved without retained-root cleanup.
- Fixture-only proposal2764c054 changes one old PUBLIC-NEGATIVE row to expect
  the authorized root export/exact subpath; other139 rows/dependency assertions
  unchanged. It is UNEXECUTED and does not change c83f/package4671 or rescore
  139/140. No retry. Different public80 review and fixture-v2 acceptance remain.
  Handoff4ade014242d6b6ceac254c41f53b46ca00102fbe:
  `tests/integration/git-public-20260829/HANDOFF.md`. No global gate/Git/native
  parity or overall superiority claim.

## 2026-08-29 — ROOT-qualified frozen public80, two-cohort I03 acceptance

- ROOT accepts exact candidate `c83f352f057c64917f219eb938f54aa42cdab829`,
  full950 SHA256 `4671ed60875c87f8cc32b735fde5d9b57301f427ecd5a376ad1123afb951e156`.
  Default79 to80 adds only Git, on accepted public79 `7fde32264d757ef856acf3ae92c8581b4a294341`
  and M1B `fca6f81d2d96db2bbceabf3247cd57ffe240bde6`. Root/subpath factories,
  options/types and replacement are accepted for that finite read-only M1A+M1B
  profile. All24 numeric caps are fixed; zero runtime dependencies, npm/npx
  exclusion, curl opt-in and pending product Node remain.
- Independent `5fabc790c6b150622460ed377d8f85d87cb246c5` retains336 passes/layout
  (public45,apply28,M1A-v2 140,packs93,arrays12,coherence18) plus11 novel passes/layout.
  Versioned continuation `caf6ba94287842fe8a63ae3226a1a9349406d46d`, evidence SHA256
  `f8e13c2982175a8d78cd6ef665b581e45bdbdf6209d9c43decef675a3591b31c`, adds only
  three I03-v2 passes, one/layout: all12 novel properties through TWO cohorts, not
  one all-green execution. Six type groups (24 exact negative diagnostics),
  maintained83, moved-consumer21 and nine loaded controls are separate categories.
- I03-v2 preserves the duplicate-registration error and observes it at frozen
  Shell.use queued setup/public exec, not a synchronous use throw. All three cases
  preserve the exact setup-reason object, observe no second middleware dispatch,
  preserve two VFS marker byte strings and fulfill disposal. The continuation
  reuses authenticated source-build/installed bytes; the vanished original install
  is reconstructed and a separate copy physically moved. No rebuild/npm/install.
- Original independent three I03 failures/coordinator exit1, author three obsolete
  module-only export failures and old public79 worker-denied79/83 remain unchanged.
  Fixture2764c054 and I03-v2 e7ce4ddf are explicitly versioned, not retrospective
  changes to those records. Historical entries above keep their then-unrun status.
- Resource observations stay separate: first cohort32 internal-loader admissions
  and four RegexWorker exits; continuation3 internal-loader admissions and zero
  RegexWorkers. Individual internal-Worker exits are UNOBSERVED; only known hosting
  process retirement is established. Module S02/H09/private-writer SOURCE gaps,
  finite format/resource scope and native6 UNRUN remain; no universal provider,
  preemption/native-allocation/RSS, full Git/Bash or performance claim.
- This is not acceptance of live HEAD, later `|&`/`&>`/Node changes, a whole gate,
  fresh comparator evidence or an overall winner. Documentation publication is
  SOURCE/DATA only; it runs no product, tests, build, compiler, native or private work.
  Exact ROOT record: `tests/integration/git-public-independent-20260829/root-acceptance/ROOT-ACCEPTANCE.md`.

## 2026-08-29 — ROOT-qualified redirectionUnit1 on exact public80

- ROOT accepts source `1e9b83d73ca6efcf84e4cb0a0b20d81f71da237e`, derived
  `ed0e0d09cf71bed7f4aee075750b60a30df4ef52`, full950 SHA256
  `e0e63b0319f0b7b77e68a6e6284021bd747c60ce9f93291a5090048fa835e296`.
  Exact base c83f352f/default80;292 inputs, only parser/runtime/display change.
- Evidence `e6a4b1ff119b8aff3b2a39110cc11311f8cbb628` plus SOURCE/DATA
  adjudication `c565f9251bd59332a58c37bc5c48948cc2f24683`:60 version-qualified
  identities/layout (48 author-v2,10 unchanged novel,N06-v2,N11-v3),103 retained
  and93 pack outcomes/layout; maintained83, moved21, six type groups/18 negative
  diagnostics, three loaded mutant kills/three restores/two binding refusals.
- Original author78 failures, bootstrap zero-body failure, N11-v2 failures and
  exits remain. Versioned ordinary-fix successors preserve full captures and
  known cleanup; no safety/integrity/capture/unknown-retirement stop observed.
  M1A stays139/140/layout. Public80 fixture-v2 2764c054/acceptance9dca6b40 supports
  SOURCE classification of its stale export assertion, NOT a redirection140/140 run.
-51 cohort direct children retired,39 fixed loader admissions,four authenticated
  app RegexWorker exits; no individual internal-Worker exit/global OS census.
  Logical release instrumentation is not native-allocation proof. Array M21
  SOURCEONLY/five MIXED, Git private-writer/S02/H09/native and AST metadata/cloning
  qualifications remain; no hard RSS/universal preemption guarantee.
- Default80/root APIs/dependencies unchanged. No native Bash/GNU-byte parity,
  full Bash, strict-mode, Node, live HEAD, whole gate or comparator acceptance.
  Documentation publication only; no runtime/native/Workers or raw-staging cleanup.
  Exact record: `tests/compatibility/bash-redirection-independent-20260829/root-acceptance/ROOT-ACCEPTANCE.md`.

## 2026-08-29 — ROOT-qualified strict-mode Unit2 resolved profile

- ROOT accepts exact source `928be5585f05c15867fbbb5f4b5debe153b0734e`, derived
  `26215b99cb379a9f825f803454f758fab5a3c8e9`, full950 SHA256
  `1fafce728b6346db4555449ba6259694346983d877a32e917fd7a15c6ebe64e4`.
  This is accepted c83 public80 plus accepted Unit1 and exactly Unit2;292 build
  inputs, Unit2 parser/runtime changes only. No moving HEAD/Unit3/Node overlay.
- Evidence `fab0c0994caf287a125cb98bb75a23a3424bf742`, manifest SHA256
  `fa86b6ca4f168c9696b5546a7df9cb419aa1fe235a23c67ac305f93357589073`:
  each source-build/installed/moved layout passes50 author +16 independent novel
  +151 retained regressions,651/651 overall. Separate6 type groups preserve18
  exact negative diagnostics;3 loaded mutants detected,3 restores pass,2 binding
  refusals. These counts are not a whole canonical gate or new nounset public-API proof.
- Accepted resolved behavior: signed e/u clusters and supported terminal-o forms,
  nounset off by default, lazy presence-sensitive missing-versus-empty expansion,
  same-logical-boundary function/source unwinding and owned subshell/pipeline/
  substitution boundaries. Existing errexit/pipefail and caller/limit/sink/cleanup
  precedence remain; no new free diagnostic bytes or public budget.
- U06/U07/U17/U27/U28/U31–U36 remain11 OPEN/UNEXECUTED/UNQUALIFIED. Arithmetic
  nounset, aggregate lengths, invalid-option partial mutation and exact GNU
  diagnostics/status/line bytes are not accepted. Fatal status1 is provisional
  project policy, not a GNU golden. No native Bash or other oracle was run.
- Review lifecycle:39 direct children plus coordinator/capture owner =41 known
  runtime processes; including publication50 known/52 conservative slots.29 fixed
  loader admissions,0 RegexWorkers; individual internal-worker exits unobserved,
  only hosting-process retirement established, not global OS/RSS/native lifetime.
- Default80 remains unchanged. Prior failures, prep HOLD and inherited provider/
  module/private-writer/source-only limits remain literal. No complete strict-mode,
  full Bash/Git, Node, live HEAD, global gate or comparator acceptance. This root
  acceptance publication is docs-only: no runtime/native/Workers or historical rewrite.
  Exact record: `tests/compatibility/bash-strict-mode-independent-20260829/ROOT-ACCEPTANCE.md`.

### 2026-08-29 — ROOT qualified restricted Node module acceptance

- Accepted exact source `a2f3983da537b95bed65b8bc727ab93bc7e98ca3`, full958 package
  SHA256 `f6b13bd116196cd5559a2d6b5d8578c5c7f614af095f7f00515bd341366c4092`,
  based on independent `1a15f7a520399a6fc73e910974ffa718b455c39c` and its explicit
  accounting clarification. Finite255 expected outcomes =183 version-mapped
  +6 BOM +66 independent, NOT255 successful guest commands; separate72 types,
  6 mutant kills/restores and6 binding/consumer controls. Q01–Q03 finite controls accepted.
- Exact ALL-process cap compliance is NOT established:126 recorded execution
  +54 reserved administration is not a measured total. Preparation/actual/admin
  census and owner-only byte-counter qualifications remain. No global resource,
  full Node/RSS/whole-guest/all-jobs or universal host-authorization proof.
- Original parser HOLD and raw failures remain; authorized ordinary captured,
  retired helper correction `c43879c6` does not rescore them.38-family coverage
  remains partial; E09's non-required rejection catch, unexecuted variants, W23
  diagnostic detail and old loop telemetry UNKNOWN remain explicit.
- Trusted explicit provider/test loader is not product authentication. Public
  opt-in integration is separate; this docs-only record changes no product/defaults.
  Exact decision: `tests/commands/node-independent-20260829/actual-review-v1/ROOT-ACCEPTANCE.md`.

### 2026-08-29 — ROOT qualified public opt-in Node acceptance

- ROOT accepts source `bb4dd0571a0335b20e29448bf88126ca02c1a32d`, derived
  `a6d20781d3c099fb7b3d36c10696beb06615af1b`, full1010 package SHA256
  `274839729aa916767d1664e0ec7a84579eb1c6e7eba677535dfe6273f5f079a9`, based on
  independent review `27f557ad6a18e06da5438e0d08d8b7ec2a703d94`. Includes accepted
  Unit2 and module `a2f3983d`, not pending Unit3/Unit4/current HEAD. Prior module
  acceptance `b10faea3e04714dbddc796971a773fa0c61495f7` and failures remain intact.
- Scope942 expected outcomes =651 retained +183 version-mapped module +72
  version-mapped public +36 independent, NOT942 successful guest commands.
  Separate2 native Node package-resolution controls,4 mutant/restoration pairs,
  2 binding refusals; strict build/offline install/physical move/12 type processes.
- 151 observed Node Workers retired,133 guest entries,23 fixed loader admissions.
  78 recorded execution processes are NOT an ALL-process census. Individual
  internal-loader exits, universal accounting/peak/byte bounds, unexecuted/partial
  families, E09's weaker assertion, W23 detail/old-loop UNKNOWN and inherited
  qualifications remain. No all-jobs/RSS/whole-guest or host-authorization proof.
- Root/exact `virtual-bash/commands/node` APIs remain explicit opt-in with a required
  trusted provider/static entry, seven default-denied grants and24 fixed limits.
  Default80 unchanged; zero runtime dependencies, no engine bundling/auto-import
  or native fallback. Restricted NP1/Worker-L, not full Node/Bash or an overall win.
- Docs-only publication: no runtime/product logic/compiler/Worker/native execution;
  original author/helper captures and historical status entries are preserved.
  Exact decision: `tests/integration/node-public-independent-20260829/ROOT-ACCEPTANCE.md`.

### 2026-08-29 — ROOT qualified conditional Unit3 profile acceptance

- Exact source `7a5c620005fb04518d44bb284f4e99284e4a7c33`, derived composition
  `74dfe69135a3fc5ba89396b20dd32d9c9daae131`,293 selected inputs, full954 package
  SHA256 `46a845f6c12933308aef11dbbf8f861afcc38ff9973b83bcccea13c3329c0a09`.
  ROOT accepts independent original `d7ec5e26c34a26ec9194ddc88d5159fecf4abeca`
  plus follow-up `cccd876f6615020a083adf7ee8c51befa553c2ba`, not moving HEAD.
- Finite840 version-qualified =831 original positives +9 fresh corrected reader
  cases, NOT one840-case rerun. Per layout67 author +201 retained +12 novel;
  separate12 type groups/33 negative diagnostics,8 original +2 fresh unique mutation
  pairs and original4 +fresh2 binding refusals. M04 now has a semantic restoration;
  M06 H02 activates the changed branch and restores, while H01 remains an explicit
  nonactivation countercontrol. No old mutation score is retroactively relabeled.
- Separate `[[ ]]` AST/lazy visited expansion/no IFS or pathname globbing/C basic
  patterns/limited numeric literals/typed VFS errno policy/canonical-index-or-scalar
  `-v`. Reached unsupported ERE/extglob/aggregates/timestamps remain refusals, not
  GNU passes. Private4096-node/depth64 grammar admission uses `ShellSyntaxError`;
  actual resource/caller/sink/cleanup behavior remains a separate contract.
- Preserve original H02 unknown-finalization failures, fixture-LF admission errors,
  N01/N10/N11 reader failures, mutant gaps and H01 nonactivation history. Controlled
  unenrolled-provider H02 and registered S01 do not establish arbitrary provider
  ownership. Source-only/mixed, loader/Worker, AST clone/metadata and census limits
  remain. Fresh41 known processes retired/11 loader admissions/zero RegexWorkers
  do not establish an individual internal-loader exit or universal OS census.
- Default80 unchanged. Prior core and public opt-in Node acceptance `6f449bf4`
  remain scoped to their own compositions; no Node-plus-Unit3/Unit4/native GNU5.3/
  full-Bash/whole-HEAD/global-gate acceptance. Docs-only publication, no new runtime,
  native, Workers, product edits or raw cleanup. Historical records remain literal.
  Exact record: `tests/compatibility/bash-conditional-independent-20260829/ROOT-ACCEPTANCE.md`.

## 2026-08-29 — ROOT-qualified Unit4/N14 source and semantic acceptance

- Exact source `7196bace8ea2c141d5ed1020fef5bf721c321ace`, selected composition
  `bf079ada185a79aec864b068f3738ddc5520822e`,293 selected inputs, full954 package
  SHA256 `3f3ae85116f12ab4354a6103c0c95e967c4e88bd2eb133e63236148a2734af49`.
  Accepted core through Unit3 only; no Node/live-HEAD overlay or default80 change.
- ROOT accepts the finite source/semantic evidence in `be7d4b98`:744 literal
  outcomes =672 author +48 prior novel +24 new identity; separate6 type groups/
  24 exact negatives,2 loaded mutant kills/2 restores and2 binding refusals.
  Source adjudication `c6992dfa` establishes expected package/loader identity before
  consumer execution, not before the original package inflation/parsing.
- The original campaign remains **CLOSED/noncompliant** with the required
  pre-inflate admission ordering. No retrospective repair, rescore, or complete
  end-to-end campaign-compliance claim. Prospective `aede1639`, preseal `9cbb83c9`,
  separately passes12 controls (including loaded ordering-mutant kill/restore) and
  one correctly admitted retained954-member inflate/parse, with no product rerun.
  Future coherent actual validation must use the corrected gate contemporaneously.
- Accepted profile: evaluated undefined scalar arithmetic reads under nounset
  fail while present-empty reads remain0; existing checked64/indexed-refusal/lazy
  semantics remain bounded. Supported `set` flags mutate incrementally before an
  invalid-tail diagnostic; existing errexit/sh-mode policies remain. Bare `-o`/
  `+o` expose only errexit/nounset/pipefail listing/replay, not the full GNU table.
  N14 preserves private diagnostic provenance only through the exact non-async
  returned invocation Promise, preserving raw falsy identity and caller/cleanup
  precedence. Transformed/async promises do not inherit that guarantee.
- Preserve original681/684, all N14/startup/fixture/admission/publication failures,
  and the separate prospective cohort. Original40 direct children plus4 outer
  roles closed;30 loader admissions are not individual observed loader exits.
  Administrative census, private/source-only and resource qualifications remain;
  no all-process, hard-RSS or native lifetime claim.
- Five OPEN IDs: `U27`, `S-U27-INPUT-UNIT-v1`, `S-U28-PRESENCE-v1`,
  `S-U31-STDIN-v1`, `E23-source-discard`. Native parity remains UNRUN; provisional
  nounset status1 and diagnostic/listing/aggregate-DISCARD/invocation questions
  are not GNU goldens or complete Bash compatibility. No Node-plus-Unit4,
  live-HEAD/global-gate or comparator acceptance. This publication is docs-only.
  Exact record: `tests/compatibility/bash-strict-extension-independent-20260829/n14-v2/ROOT-ACCEPTANCE.md`.
