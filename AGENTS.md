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
  source/tests without coordination. Defer metadata until curl's independent
  checkpoint. Count optional curl separately from the default command bundle.
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
- Middleware must await or return `next()`. Filesystem adapters and command
  implementations must propagate the supplied signal into host work; helper
  cancellation does not forcibly terminate an uncooperative host operation.
- `CommandContext.invoke?: CommandInvoker` invokes literal argv; its optional
  overrides are stdin, stdout, stderr, cwd, and env. The shell retains filesystem,
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
- `agentCommands(options?)` from the package root installs the six delivered
  command families as one bundle; `createAgentCommands(options?)` returns their
  definitions. One top-level `replace` controls all registration; preflight all
  collisions before modifying the host registry. Do not install individual
  families again unless replacement is intentional. `text`, `structured`,
  `search`, and `diffPatch` preserve the existing family option/limit types;
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
