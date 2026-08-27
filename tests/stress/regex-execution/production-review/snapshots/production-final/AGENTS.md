# Project Rules

## Authority and ownership

- Work only in /Users/kjopek/Workspace/safe-bash. The directory correction did
  not rename the package: it remains virtual-bash.
- Preserve ../AGENTS.md: the root agent delegates substantive work, coordinates
  workers and synthesizes results; leaf workers implement, investigate and verify.
- User statements are authoritative. Preserve exact requirements without
  invention, reinterpretation or silent scope reduction.
- Current root assignments override historical ownership snapshots. Confirm
  ownership before editing; read other workers' source without changing it.
  Root package/export changes stay with the assigned integration owner.
- Keep this file concise: durable rules, exact requirements and stable trust/
  coordination conventions only. Timestamped counts, commits, worker statuses
  and historical facts belong in docs/PROJECT_LEDGER.md and linked evidence.
  Migrate history without discarding it; archived instructions are not active rules.

## Exact requirements and scope

- Build an extensible virtual Bash companion to poe-code packages/safejs,
  inspired by just-bash, with Express-like plugins; memory, real, S3-compatible
  (including a mock), WebDAV and further filesystems; many agent-used tools;
  full piping, stdin and shell support. A scaffold or passing subset is not completion.
- User: **"IT MUST BE BETTER than just-bash, much better"**. Require broad,
  reproducible head-to-head evidence; never redefine superiority as a small
  passing subset, command-name count or selected performance win.
- User: **"one more note - zero dependency if posisble"**. Keep zero runtime
  dependencies where possible; Node builtins and minimal TS development tooling
  are permitted. Comparator dependencies belong in the isolated benchmarks package.
- User: **"i also need curl"**. Network use must be explicitly enabled and usable,
  with authorization at every redirect hop, credential protections, cancellation,
  byte streaming and VFS I/O. Do not auto-enable network capability in agentCommands.
- User: **WORK 72 hours**. Record actual work; do not claim duration or full
  completion without evidence. Build tools, then use a different agent to stress/fix.
- User: **"init git, make atomic commits"**. This dedicated repository is already
  initialized. Never initialize the broad Workspace or commit existing user changes.

## Codebase and public API

- TypeScript ESM, strict NodeNext, Node.js >=22; use .js specifiers in TS imports.
  Runtime dependencies stay empty. Product virtual commands never spawn native
  processes or access implicit host files; native utilities are test oracles only.
- The real filesystem adapter accesses only its explicitly configured root.
  Network adapters require explicit host configuration; do not read ambient
  credentials, mutate global TLS/environment state or invent provider guarantees.
- Root exports are src/index.ts and package.json exports. Publish examples only
  from inspected APIs with build/public-consumer evidence, not proposed names.
  An internal module or loopback mock alone does not prove bundled real-service support.
- agentCommands/createAgentCommands compose command families with a single
  replacement policy and collision preflight. Do not double-register families
  without intentional replacement. Family limits are not one shared shell budget.
- Curl and SafeJS are optional explicit plugins, not default aggregate commands.
  SafeJS requires injected legitimate runtime hooks; never install/load a private
  package implicitly, vendor the engine or modify the private poe-code checkout.
  Proposed upstream patches are not approved integrations or replay guarantees.

## Streams, invocation and filesystem safety

- Contracts are src/contracts/**. Command/FS payloads are Uint8Array. Await sink
  writes, preserve backpressure and chunk ownership, and bound collected output.
  Shell exec returns buffered results while internal pipelines use byte streams.
- Middleware must await/return next(). Preserve shared budgets and explicitly
  propagate signals into host work. Cancellation cannot undo completed effects
  or forcibly stop uncooperative host work; observe late rejections.
- CommandContext.invoke dispatches literal argv with existing middleware, FS,
  signal and shared budgets. replaceEnv true uses exactly the supplied exported
  map (omitted means empty), without inherited exports/PWD injection or local
  promotion; omitted/false retains merge compatibility. Preserve parent state.
  Test actual Shell/registry invocation, not only a stub. See src/contracts/command.md.
- stdinIsDefault describes provenance, not bytes/EOF/readability. Preserve it
  through transparent forwarding; replacement streams choose origin explicitly.
  xargs child input is the implicit empty default, not consumed argument input.
- Use readBytes/writeBytes with the supplied signal. POSIX path helpers are
  virtual; lexical containment is not symlink containment or namespace authority.
- Safe empty-directory removal uses optional FileSystem.rmdir, otherwise ENOTSUP.
  Never approximate it with an empty listing followed by recursive deletion.
  Force flags must not swallow cancellation, including errno-shaped abort reasons.
- identityScope/device/inode and compareEntry follow src/contracts/filesystem.md.
  Opaque scopes compare by reference and mean real disjoint storage, not different
  clients/protocols. Unknown stays unknown; preserve aliases, conflicts and errors
  before destructive publication. Comparison is not a lease, transaction or ABA defense.
- Provider authority is an explicit trusted host binding to the backing resource
  used by content operations. Faithful forwarding preserves provenance and path/
  stat binding; remappers/cache gateways omit or replace changed assertions.
  Host JavaScript is not sandboxed. Resolver callbacks must be truthful, preserve
  composition/alias precedence and cancellation, and use public consumer APIs.
- With permissions:false, modes may be advisory, never privacy guarantees;
  chmod remains unsupported. Access is a best-effort policy probe, not proof of
  later GET/PUT success. Do not fabricate missing stat fields or remote enforcement.
  mktemp uses exclusive VFS creation and documented virtual-temp prerequisites.
- Filesystem errors use typed FsError.code. Shell stderr is human-readable
  utility output, not errno serialization. Preserve error meaning/path, status
  and exact byte/namespace effects; no blanket diagnostic-assertion relaxation.

## Evidence and dialect discipline

- Preserve original cohorts, failures, fixture inputs and oracle defects beside
  later corrections. Record exact source hashes, profiles, versions, denominators,
  dirty-vs-frozen state and external-oracle availability. Unmeasured/unsupported
  cases and TODOs are not passes; scoped suites do not imply a current full gate.
- Environment ordering is POSIX-unspecified. A GNU capture on Darwin does not
  establish GNU/Linux semantics; qualify host/library profiles. Strict SGID
  differences need host-specific evidence, not a mandatory new API or unsafe rollback.
- Retain the user's verified GNU sed4.9 policy for global ^|$ substitution and
  invocation-wide successful quit under -i/-s; do not emulate BSD later-file
  truncation just to match an oracle. Preserve the original BSD evidence.
- Do not falsely label registry commands as builtins for comparison parity.
  Separate terminal byte-API differences from internal pipe/file corruption.
  Benchmark scratch setup is a harness role, not a fake product directory effect.
- Compare native semantics, backend interoperability and performance separately.
  Time/memory cohorts require matching outputs/effects, repeat/order controls,
  source hashes and cohost-load caveats. Include baseline-only coverage gaps.
- Prioritize real adapter/tool workflows over more names. Backend unit or mock
  success alone does not establish deployed-provider behavior; helper/fixture
  semantic changes must be disclosed, not called unchanged all-input proof.

## Validation and commits

- npm test runs node:test through tsx; npm run test:contracts targets contracts;
  npm run typecheck checks source/tests; npm run build emits ESM/declarations in dist.
  Run scoped checks first; do not rerun competing owners' entire suites needlessly.
- Inspect git root/status/index before changes. Use apply_patch, stage explicit
  owned paths and git commit --only with those paths. Preserve concurrent edits,
  staging and native temporary artifacts; never broad-stage or commit others' work.
- Do not create branches or alter unrelated worktrees without instruction.
  Keep documentation corrections narrow and atomic; report checks and remaining
  limits without claiming superiority, universal parity or completion.
