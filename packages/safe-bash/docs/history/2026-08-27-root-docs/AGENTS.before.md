# Project Rules

## Authority and coordination

- The intended project directory is `/Users/kjopek/Workspace/safe-bash`.
- Work exclusively in that directory. The location correction does not request
  a package or API rename; the package remains named `virtual-bash`.
- Follow the parent `../AGENTS.md`: the root agent coordinates and synthesizes;
  subagents perform substantive implementation, investigation, and verification.
- User statements are authoritative. Preserve explicit instructions and facts;
  do not expand, reinterpret, invent, or silently reduce the requested scope.
- This documentation assignment is a leaf task; no further delegation is needed.
- Maintain this file as codebase rules become established. Keep durable
  requirements, evidence, and pending work in `docs/PROJECT_LEDGER.md`.

## Requested product and workflow

- Build `virtual-bash`, a virtual Bash companion to `poe-code safejs`, inspired
  by `just-bash`, with Express-like plugin syntax.
- Preserve the full target: memory, real, S3-compatible (build a mock), WebDAV,
  and additional filesystems; many agent tools; piping, stdin, and full shell
  support. A partial implementation does not satisfy the full-shell goal.
- Preserve the user's exact requirement: **"IT MUST BE BETTER than just-bash,
  much better"**. This requirement is not yet demonstrated. Require broad,
  reproducible head-to-head benchmark evidence before claiming superiority;
  do not redefine it as passing a tiny selected subset. Record comparison
  criteria, versions, workloads, results, losses, and remaining gaps.
- Build tools sequentially, then run independent stress-test/fix cycles.
- Preserve the explicit user requirement: **"i also need curl"**. Curl is an
  explicitly enabled network plugin, not ambient networking in `agentCommands()`.
  Use injected authorization/transport, VFS-only file access, zero runtime
  dependencies and no native curl or subprocess in product code.
- After the accepted curl author handoff, Archimedes is the sole owner of
  `src/commands/network/**` and its author/independent tests. Curie retains root
  exports, package/inventory audits and documentation only; do not edit network
  source/tests without coordination. Count optional curl separately from the
  default bundle. The metadata author integration adds chmod/stat/mktemp to
  the earlier 49-command bundle (52 defaults); curl and SafeJS remain optional.
  Archive integration adds tar afterward (53 defaults); the resumed table-text
  author integration adds paste/comm/join (56 defaults), without duplicating cut.
  Metadata, archive and table-text
  receive different agents' independent stress/fix review; name counts do not
  establish option coverage. These integrations are separate from earlier curl
  delivery evidence.
- Curl finalization `17285d1` records 214 targeted passes across six separately
  counted cohorts, build success and 5/5 built-package checks on network source
  `aa2da57`; `cbde2fe` corrects one stale author assertion using frozen native
  evidence. Preserve historical 80/81, 57/60 and 14/15 observations. This is not
  full curl parity, DNS/socket confinement, universal first-read cancellation,
  or a clean committed-HEAD validation: global typecheck recorded three unowned
  FS-test errors and the build included uncommitted metadata root wiring.
  Keep the `head -n 0` custom lifecycle limitation separate and visible; no
  shared output-lifecycle API is approved by this curl checkpoint.
- Preserve the user's exact preference: **"one more note - zero dependency if posisble"**.
  Keep the shipped library at zero runtime dependencies where possible and use
  Node builtins. Minimal development tooling is permitted; isolate comparator
  dependencies in the optional `benchmarks/` package rather than the library.
- The user explicitly requested **WORK 72 hours**. Record actual work and
  remaining scope; do not claim this duration or completion without evidence.
- Initialize Git and make atomic commits. Git is already initialized as of the
  initial documentation inspection; do not reinitialize it unnecessarily.
- Stage explicit owned paths only. Do not include another worker's changes in
  a commit or alter their files without a revised ownership assignment.

## Established foundation and validation limits

- Foundation commit `5468d14` establishes TypeScript 5.9, ESM, Node.js `>=22`,
  strict NodeNext compilation, and `node:test` through `tsx`. There are no
  runtime dependencies in that foundation package; tooling is development-only.
- Shared contracts are in `src/contracts/**`, exported by
  `src/contracts/index.ts` and `src/index.ts`. Use `.js` import specifiers in
  TypeScript. Command and filesystem payloads are explicitly `Uint8Array`;
  await byte-sink writes and set an explicit `maxBytes` when collecting output.
- `FileSystem.rmdir?(path, options?: FsOptions)` is the optional safe
  empty-directory primitive; see `src/contracts/filesystem.md`. Keep existing
  `rm` semantics. Core `rmdir` and directory-only `rm -d` must use this method,
  report absent support as `ENOTSUP`, and never approximate it with an empty
  listing followed by recursive deletion. Preserve cancellation even when its
  reason has an errno such as `ENOENT`; `-f` must not swallow caller aborts.
- Optional `FileStat.identityScope` scopes backing-entry device/inode identity;
  see `src/contracts/filesystem.md`. Compare opaque object/symbol tokens only
  by reference, and require complete nonnegative safe-integer IDs. Different
  scopes must mean disjoint storage, never merely different adapters/clients.
  Wrappers preserve actual backing identity; incomplete/remote-unknown identity
  cannot justify a truncating cross-backend destination open. This is not a
  lease, transaction, ABA defense or pathname-race guarantee. Poincare owns all
  backend identity propagation and copy guards; Curie owns contracts/type tests.
- `FileSystem.compareEntry?(path, peer, peerPath, options?: FsOptions)` returns
  `Promise<"same" | "distinct" | "unknown">` for actual followed backing entries.
  See `src/contracts/filesystem.md`: metadata-only recognized authority, no
  content acquisition or mutation, unknown stays unknown, real errors/cancellation
  propagate, and invalid/conflicting answers fail EIO before effects. It does not
  authorize unlinking an unknown final symlink or establish a lease/ABA defense.
  No broad guarded-copy trust flag or fabricated per-client identity is approved.
- With `permissions:false`, creation modes may be advisory, never a privacy
  guarantee. Chmod remains ENOTSUP; regular-file X_OK may deny EACCES while
  directory traversal succeeds. Access is a best-effort backend-policy probe,
  not proof that later GET/PUT succeeds. Preserve real denial, missing, read-only
  and cancellation errors. The S3 profile ruling is an intentional expectation
  delta, not a source fix or permission-enforcement claim.
- Middleware must await or return `next()`. Filesystem adapters and command
  implementations must propagate the supplied signal into host work; helper
  cancellation does not forcibly terminate an uncooperative host operation.
- Fresh provider-owned entry observations may survive faithful opaque forwarding
  without client/fetch/factory method-reference eligibility. Preserve fresh query
  provenance and FS/path/stat binding; identity must describe the resource used
  by corresponding content operations. Remappers/cache gateways omit or replace
  assertions when binding changes. Host JavaScript is trusted to honor this
  semantic contract, not sandboxed; legitimate cross-backend aliases still need
  protection. No fabricated scope or broad trust flag. See the exact approved
  rule in `src/contracts/filesystem.md`; Poincare implements and Dirac reviews.
  Generic SDK/copied-metadata integration remains open, and qualified38/38 does
  not close original31/38 or the broader backend goal.
- Root approved an additive S3/WebDAV constructor option named compareEntry
  using the existing filesystem comparison contract for serialized SDK-like
  clients. It is an explicit truthful host backing-resource resolver: preserve
  composition/alias precedence, errors and cancellation; never fabricate client
  identity or require private mock APIs in consumer examples. Poincare owns
  adapter source/types/docs/tests; shared contracts remain unchanged. Curie
  reviews the concrete handoff, not a new design-approval gate. Author original
  38/38 evidence is distinct from Dirac's pending independent acceptance and
  arbitrary-provider support.
- `CommandContext.invoke?: CommandInvoker` invokes literal argv; its optional
  overrides are stdin, stdout, stderr, cwd, env and replaceEnv. The approved
  replacement rules are in `src/contracts/command.md`. Runtime acceptance must
  use an actual Shell/registry child, not only a stub invocation callback.
  The shell retains filesystem,
  cancellation, middleware, and execution budgets; there is no signal override.
- `CommandContext.stdinIsDefault?: boolean` records provenance, never byte count:
  true is implicit no-input default; false is supplied/piped/redirected/closed
  input; absent is unknown. Reads, EOF, and exhaustion never change it.
  `CommandInvokeOptions.stdinIsDefault` applies only with supplied stdin; omitted
  stdin inherits parent metadata, while replacement stdin defaults to false.
  Transparent forwarders preserve metadata explicitly; replacing a stream must
  deliberately choose its provenance. `xargs` gives children an implicit empty
  default, rather than its consumed argument-input stream. Never probe a stream
  to discover input origin or interpret this field as a readability guarantee.
- Use `readBytes(source, signal)` and `writeBytes(sink, chunk, signal)` for command
  I/O that must stop waiting on cancellation. They observe late rejections;
  cancellation still cannot undo host side effects or interrupt synchronous work.
- `normalizePath`, `resolvePath`, and `relativePath` use virtual POSIX paths.
  `isPathWithin` and `assertPathWithin` are lexical containment helpers, not
  symlink security guarantees.
- Commands: `npm test` runs `tests/**/*.test.ts`; `npm run test:contracts` runs
  contract tests; `npm run typecheck` checks source and test types;
  `npm run build` emits ESM and declarations to `dist/`.
- Root exports include delivered shell, standard/text/structured command
  plugins, filesystem adapters/wrappers, and SafeJS bridges. Wrapper package
  subpaths are `./fs/readonly`, `./fs/mount`, and `./fs/overlay`.
- `agentCommands(options?)` from the package root installs the nine delivered
  command families as one bundle; `createAgentCommands(options?)` returns their
  definitions. One top-level `replace` controls all registration; preflight all
  collisions before modifying the host registry. Do not install individual
  families again unless replacement is intentional. `text`, `structured`,
  `search`, `diffPatch`, `metadata`, `archive`, and `tableText` preserve existing family option/limit types;
  they are not one shared budget. Shell limits remain separate.
- Wrapper parity is incomplete: mount rejects missing/dangling symlink tails;
  overlay metadata is instance-local, hardlinks are unsupported, stream buffers
  default to 64 MiB, and the upper backend must support atomic rename. A shared
  namespace-aware resolver needs separate design and tests, not an assumed cast
  or a lexical-containment workaround.
- Optional comparison: `npm --prefix benchmarks ci --ignore-scripts`, then
  `npm run benchmark`. It runs every oracle fixture and deterministic probes,
  writes machine-readable results, and exits nonzero for any non-pass outcome.
  Comparator versions are pinned in its isolated lockfile; do not exclude
  unsupported or pending outcomes from the denominator.
- At foundation delivery, all four commands and built-package import checks
  passed. After the contract stress fixes, 65 contract tests and owned-scope
  typechecking passed, including 20 strict-rejection repetitions. A subsequent
  whole-repo typecheck encountered concurrent filesystem and shell errors;
  record fresh whole-repo results rather than treating scoped success as a
  product-wide pass. See `docs/PROJECT_LEDGER.md` for commands and revisions.
- At the initial inspection on 2026-08-26, the repository contained only `.git`
  and had no commits. No source, package scripts, or tests were established.
- Until implementation is inspected and validation succeeds, do not document
  proposed exports, plugin signatures, installation steps, or test commands as
  working. Update the README and ledger when concrete evidence is available.
- Document verified code conventions and commands here when established;
  keep planned acceptance gates distinct from recorded test results.
- Prioritize actual remote-adapter/tool interoperability over adding tools.
  Backend unit/conformance success alone does not establish pluggability. Keep
  the unchanged aggregate adapter matrix, its failures, and remote-provider
  limitations visible; do not waive required behavior with capability skips.
  This priority does not narrow the full product goal.
- Shell stderr is human-readable native-Bash/utility-dialect output, not a
  serialized errno protocol. Assert typed `FsError.code` at the filesystem API
  boundary. For shell integration, preserve nonzero status, correct error
  meaning/path and exact byte/namespace effects. Poincare may reconcile only the
  eight identified matrix errno-string assertions with stronger boundary checks
  and recorded evidence; no sweeping relaxation or unrelated expected changes.
- SafeJS command execution is optional and host-injected. Root exports must not
  auto-register it through `agentCommands()` or load a private package. Require
  explicit runtime hooks (`run`, `createBudget`, `makeFsModule`,
  `declareHostOperation`) for execution; preserve zero runtime dependencies.

## Utility dialect policy

- Keep fresh jq closure evidence cohort-specific: d1f78d4/0278a30 and independent
  bb1ceabe close the42 original audit failures with790/790 exact executions.
  Separate94 legacy probes (45 exact/49 nonexact) and22 historical red tests
  remain Archimedes-owned until native-backed fixes/classification. Do not turn
  this checkpoint into a clean whole-product snapshot during concurrent FS work.

- Preserve the user's decision to retain verified GNU sed 4.9 behavior for
  global `^|$` substitution and invocation-wide successful quit under `-i`/`-s`.
  Do not reproduce BSD's later-file truncation merely to match that oracle.
- The two policy tests use independently captured GNU expectations pinned by
  the hash of `tests/commands/text-programs-stress/dialect-evidence.json`.
  Keep its BSD observations immutable; diagnostic reruns write separate files.
- Report selected-dialect acceptance separately from the unmodified live-native
  matrix, including exact expectation sources, versions/hashes and denominators.
  No other failure, unsupported feature, or unavailable oracle becomes a dialect
  exception. Fixture changes require new independently reviewed evidence.
- This is not universal GNU/BSD utility compatibility, universal Bash support,
  scope completion, or evidence of superiority. Ambiguous capture behavior still
  differs across native dialects and remains explicitly documented.

## Documentation ownership

- The initial documentation worker has finished. The user temporarily assigned
  the foundation worker `AGENTS.md` and `docs/PROJECT_LEDGER.md` to record the
  exact superiority requirement and established foundation evidence. This
  initial reassignment did not include `README.md`; the later aggregate-plugin
  assignment explicitly includes root README usage and validation updates.
- The oracle worker also owns `tests/fixtures/shell-cases.json`; do not edit it.
  Their assignment is at least 40 verified Bash fixtures tagged by feature as
  `core` or `advanced`. Track delivery and verification separately from intent.
- All edits for this documentation assignment must use `apply_patch`.
- Coordinate API details with foundation contracts worker Curie
  (`01a03f3d-492a-7e30-af3e-1e0e0e56f7e7`) before publishing API examples.
- The foundation worker owns contracts, root exports/configuration, benchmarks,
  core commands, and independent command verification. After the author handoff,
  it also owns `src/commands/text-programs/**`, its author tests, and independent
  `tests/commands/text-programs-stress/**` for stress-driven fixes.
- Exclude all adapters, `tests/stress/adapters/**`, `tests/fs/conformance/**`,
  `src/commands/bytes/**` and its tests (Plato); `src/commands/structured/**`
  and its tests (Archimedes); `src/commands/search/**` and its tests (Poincare);
  shell source/tests and `benchmarks/shell-stress/**` (Sagan).
- Poincare now owns all filesystem source, backend/wrapper tests, adapter
  conformance/stress, and `tests/integration/adapter-tools/**`. Core commands
  and shared contracts remain Curie's; route cross-layer changes explicitly.
- Faraday owns metadata production/tests after the author handoff; Curie retains
  root package/exports/aggregate wiring.
  Do not fabricate unavailable stat fields or remote permission enforcement;
  mktemp uses exclusive VFS creation and requires an existing virtual temporary
  directory and declared permission support. Preserve explicit GNU/BSD oracle
  differences and bounded author evidence, not universal utility parity.
- Dirac owns archive production/author tests and independent archive stress after
  Archimedes' author handoff. Do not edit `src/commands/archive/**` or its tests;
  only Curie changes root exports/aggregate/package entries. Standalone archive
  fixtures must not double-install tar after aggregate integration without an
  intentional replacement. Exclude Dirac's frozen
  integration audit `benchmarks/reports/current-integration/**`; its observations
  must remain separate from moving-worktree and metadata author checkpoints.
- Curie's table-text author checkpoint `9d1e0fa` resumed after the comparison
  contract handoff. The root/aggregate now includes paste/comm/join; cut remains
  in the standard family. A different agent must independently stress/fix this
  author delivery. Required positive remote workflows and source-preservation
  guards still take priority over further tool breadth. Preserve the three
  Buffer-reuse failures fixed by `32513a4`, and do not count the documented GNU
  shared-stdin disagreement as a native parity match.
- Faraday now owns table-text production/author and independent tests. Curie
  retains root exports/docs/contracts and comparative benchmarks; do not edit
  table-text source or its tests. Its bounded independent checkpoint is not full
  GNU parity or a substitute for broader remote/workflow verification.
- Plato's distinct core-consumer review is closed at `0bee8e7`: protect cp-P
  source symlinks before unlink and preserve GNU9.7 EXDEV alias-move status1.
  Independent92/92 and11/11 mutants are separate from author70/70 after the two
  assertion-only corrections in `fe97802`. Preserve original85/92 and68/70.
  This does not close Poincare's required remote positive38/authority gate.
- New tool authoring is paused while current features are independently verified.
  Curie's bounded comparative expansion must retain historical118 recipes and
  just-bash3.4.2, use actual registries/kernel dispatch and explicit native
  profiles, retain failures/unsupported cases, and never change production to
  improve scores. Network fixtures are local and explicitly authorized. Backend
  capability evidence and native semantic parity are separate. Performance is
  measured only after output/effect equality with repeats/order/load caveats;
  no aggregate superiority claim follows from selected passing workloads.
- Expanded-comparison native validity must include launcher/byte/path controls,
  not merely the final exit status. Preserve the initial oracle defects and raw
  scores alongside corrected evidence; do not edit recipes to hide failures.
  The224-case cohort has223 unique inputs, two historical script overlaps and
  incomplete baseline-only command coverage. Keep terminal byte-API mismatches
  distinct from internal pipe/file corruption, and performance TS-source versus
  bundled-package/setup differences explicit. Distinct fairness review is pending.
- Curie's routed core/bytes author fixes are `b5ec52a` (realpath/wc), `f3eb0fe`
  plus type-test correction `afcea6c` (sort), and `8bf6f43` (cksum algorithms).
  This narrow checksum assignment supersedes the general bytes exclusion only
  for that routed work. Distinct source/performance verification remains due.
  Preserve the frozen224 observations. Approved replaceEnv semantics are in
  contract/core commit84fc742; Sagan runtime integration and actual-shell proof
  remain required. Env ordering commit6b81bb3 follows the pinned gnulib rule
  (prepend new names, replace existing positions), not a final-output reversal
  or benchmark normalization. Original ordering failures remain historical.
- Preserve the shell cohorts independently: reported `90cbf28` is72/72 holdout
  and132/132 author, while frozen expanded-seven `5cfb70a` remains0/7 and native
  GNU5.3/Bash3.2 both7/7. Dirty source/dot/eval48/48 is not accepted closure.
  Type classification must reflect actual registry/kernel dispatch; never call
  a registry command a builtin solely to satisfy a comparison expectation.
- Benchmark scratch setup is a harness role outside the asserted fixture, not
  a product requirement to manufacture `/fixture/tmp`. Preserve old native
  captures/scores beside the separate scratch-aligned profile. The distinct
  baseline-only matrix has53 frozen names, three measured primary recipes and
  fifty unmeasured names; unmeasured is never success or complete parity.
- Curie independently owns `tests/stress/s3-policy/**` for rename policy review;
  read adapter source but send source fixes to Poincare. Keep capable-client
  ordinary rename useful while testing preconditions and honest partial errors;
  never infer global atomicity, incarnation identity or snapshot isolation.
- The S3 policy recheck routes source remediation to Poincare, not Curie. Reject
  unsafe capability downgrades before effects without blocking legitimate
  guarded basic rename; retain measured non-atomic and ETag-identity limits.
- Also exclude `src/commands/diff-patch/**` and `tests/commands/diff-patch/**`
  (Faraday, independent verifier after author handoff); no source ownership
  transfer to the foundation worker has been granted.
- Exclude optional injected SafeJS commands in `src/commands/safejs/**` and
  `tests/commands/safejs/**` (Dirac, independent verifier after Plato's handoff),
  and cross-adapter tool integration in
  `tests/integration/adapter-tools/**` (Poincare). Do not stage unowned native
  temporary directories left by other workers' oracle runs.
- Dirac's upstream SafeJS validation is isolated in `/tmp`; artifacts belong to
  `docs/upstream-patches/safejs/**`, `tests/safejs-stress/**` and the existing
  `tests/commands/safejs-stress/**`. Do not modify the private `poe-code`
  checkout, vendor the engine or add a private runtime dependency. Keep
  unpatched observations separate from any isolated-patch results; passing
  known-defect characterizations are not successful guest semantics.
- Exclude Archimedes' independent `tests/stress/remote-cancellation/**` and
  `tests/integration/adapter-tools-diagnostics/**`. Their scope is not the
  existing blocked-pipe cancellation test or a blanket matrix reclassification.
- Use explicit-path `git commit --only` after staging owned paths so a concurrent worker's index entries do
  not enter another worker's commit.
