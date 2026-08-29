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
- User: **"Make sure that on the surface nobody is going to notice that it's not a real bash"**.
  Treat this as semantic compatibility, not cosmetic identity: verify quoting,
  expansions, pipelines, exit statuses and output bytes with differential tests.
  Do not claim indistinguishability while observable gaps remain.
- User: **"one more note - zero dependency if posisble"**. Keep zero runtime
  dependencies where possible; Node builtins and minimal TS development tooling
  are permitted. Comparator dependencies belong in the isolated benchmarks package.
- User: **"i also need curl"**. Network use must be explicitly enabled and usable,
  with authorization at every redirect hop, credential protections, cancellation,
  byte streaming and VFS I/O. Do not auto-enable network capability in agentCommands.
- Prioritize the user-provided command table in docs/COMMAND_PRIORITIES.md:
  sed, rg, git, printf, nl, cat, node, head, apply_patch, echo, find, tail, ls;
  retain the separate curl requirement. User: **"without the npm stuff"** excludes
  npm/npx product commands, not npm/Node/TypeScript development or oracle tooling.
  Node remains a requested product command; neither host tooling nor the optional
  SafeJS interpreter establishes product Git/Node/apply_patch compatibility.
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
- When default registration changes, synchronize maintained exact inventory
  assertions and independently declared expected names in the coherent version.
  Keep sealed historical fixtures/profiles immutable and versioned; never derive
  expectations from the registry under test or weaken exact counts.
- Curl and SafeJS are optional explicit plugins, not default aggregate commands.
  SafeJS requires injected legitimate runtime hooks; never install/load a private
  package implicitly, vendor the engine or modify the private poe-code checkout.
  Proposed upstream patches are not approved integrations or replay guarantees.
- Node is explicit opt-in with a required trusted provider/static engine adapter;
  entry URLs and identity strings are configuration, not byte authentication or
  host authorization. Never auto-load/bundle an engine or add native fallbacks.
  Preserve restricted Worker-L retirement semantics, not full Node/all-jobs/RSS claims.

## Streams, invocation and filesystem safety

- Contracts are src/contracts/**. Command/FS payloads are Uint8Array. Await sink
  writes, preserve backpressure and chunk ownership, and bound collected output.
  Shell exec returns buffered results while internal pipelines use byte streams.
- Copy retained ByteSource fragments into owned bytes before advancing or
  finalizing the producer; Buffer.slice/subarray are views, not copies. Completed
  awaited transient writes need not copy indiscriminately. This tested producer-
  reuse contract does not promise arbitrary concurrent mutation safety or leases.
- Middleware must await/return next(). Preserve shared budgets and explicitly
  propagate signals into host work. Cancellation cannot undo completed effects
  or forcibly stop uncooperative host work; observe late rejections.
- Register cooperative InvocationCleanup synchronously through registerCleanup
  before invocation-owned resource acquisition/admission; use the same idempotent
  cleanup from finally, sharing completion across overlapping calls. Close owned
  acquisition admission and cover admitted work. Outcome selection and public
  exec/dispose settlement await registered cooperative cleanup/tracked resource
  work and the root cleanup barrier, not opaque host work.
  Direct/custom hosts may omit the hook; finally remains necessary.
- ByteSink.ownedOutput is optional, destination-specific enrollment. Apply the
  cleanup-before-acquisition rule to createOutputOperation; close blocks new work
  and drains admitted cooperative resources and explicit child scopes. Wrapping
  a sink does not establish child ownership. Closing stdout must not cancel
  sibling file/header/stderr work or the whole command context merely to close
  that destination. Unenrolled opaque work gains no arbitrary preemption.
- CommandContext.invoke dispatches literal argv with existing middleware, FS,
  signal and shared budgets. replaceEnv true uses exactly the supplied exported
  map (omitted means empty), without inherited exports/PWD injection or local
  promotion; omitted/false retains merge compatibility. Preserve parent state.
  Test actual Shell/registry invocation, not only a stub. See src/contracts/command.md.
- CommandInvokeOptions.signal is optional, permits explicit undefined and is
  borrowed; omission/undefined adds no local cancellation resources. Preserve
  root-caller cancellation > escaping execution/control failure > local
  cancellation. Do not infer provenance from reason equality or global mappings,
  or raise an escaping error from an already mapped result status.
- stdinIsDefault describes provenance, not bytes/EOF/readability. Preserve it
  through transparent forwarding; replacement streams choose origin explicitly.
  xargs child input is the implicit empty default, not consumed argument input.
- PIPESTATUS is lazy and typed: preserve visible scalars and readonly absence;
  internal completion may atomically replace a visible indexed binding even when
  readonly. Stage on the shared array ledger; publish qualifying numeric raw
  stage vectors before aggregate/errexit handling, not compound-wrapper or rejected
  completions. Local scalar shadows and outer indexed restoration remain distinct.
- `local -a NAME[=VALUE]` creates a generic indexed local using the shared array
  ownership/restoration path; plain `local` remains distinct. Do not special-case
  PIPESTATUS to simulate indexed declarations or reinterpret unsupported flags as names.
- Use readBytes/writeBytes with the supplied signal. POSIX path helpers are
  virtual; lexical containment is not symlink containment or namespace authority.
- Safe empty-directory removal uses optional FileSystem.rmdir, otherwise ENOTSUP.
  Never approximate it with an empty listing followed by recursive deletion.
  Force flags must not swallow cancellation, including errno-shaped abort reasons.
- Preserve the explicit weaker capabilities.snapshotRmdir snapshot-marker profile
  through wrappers or refuse delegation; never erase it or promote it to strong
  empty-only semantics. Strong consumers must resolve the path's actual contract
  or refuse. Neither profile permits deleting descendants, including hiding them
  by overlay whiteouts. Marker success need not mean directory absence; it provides
  no transaction or ABA guarantee. See src/contracts/filesystem.md.
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
- FileStat.allocatedBytes is optional provider-reported allocation: a nonnegative
  safe integer, with zero known and absence unknown. Preserve it through wrappers;
  do not invent it from logical size or interpret it as unique physical storage/RSS.

## Evidence and dialect discipline

- Canonical tests must not rewrite committed evidence. Explicit capture writes
  to unique isolated output directories, preserving existing captures.
- Cross-realm tool-role validation checks exact finite own-data types, keys,
  values and sequence order, not prototype identity. Reject holes, accessors
  and extras without coercion; preserve actual thrown-reason identity and strict
  route admission. This is not a hostile host-JavaScript sandbox guarantee.
- Reusable current canonical tests must not pin historical implementation bytes
  as current. Version-specific reproduction/audit drivers remain explicit opt-in
  with immutable data, outside canonical discovery.
- Explicitly authorized committed-archive gates bind immutable candidate Git
  inputs and verify archive integrity before/after execution. Unrelated live
  edits neither enter nor veto that archive; never overlay live product inputs.
  Strict-live gate mode retains its dirty-input rejection.
  State whether post-run checks also detect new entries; checking only original
  tracked paths does not establish an append-proof tree.
- Computed composition/Merkle/Git-tree hashes need not name stored objects.
  Authenticate all inputs and recompute exact canonical tree bytes/hashes; do
  not require git rev-parse success for a declared derived-only identity.
  Claims of stored commits/blobs/trees still require object verification.
- Inventory canonicalization must declare one explicit pathname domain and shared
  producer/verifier ordering; do not mix locale, component and full-path ordering.
- A sparse witness is not a complete inventory; preserve that distinction in guards.
- Establish trusted outer-owned raw startup capture before fallible admission or
  child launch, so early bootstrap failures do not depend on inner publication.
- Generated and inherited compressed artifacts require regular-file, bounded
  compressed-size/read and expected-hash admission before inflation or parsing.
  Decode the same authenticated bytes and budget concurrently retained buffers.
- Critical admission/launch dispatch uses sealed files and explicit arguments in
  self-contained entrypoints, not ambient cross-call REPL bindings. Establish
  capture/catch ownership before fallible state lookup; do not infer a shared-state
  or cross-agent kernel cause from an undefined binding alone.
- Resource census and closure helpers must be file-based, take explicit owned
  roots, use invocation-local counters, and return one immutable snapshot.
  Never use ambient REPL counters or reset/rebound globals, or substitute a
  cumulative counter for a fresh sample.
- Authenticate Git path inventories from NUL-delimited records and byte-exact
  paths, not C-quoted line displays; never reinterpret quoted display names as
  filenames or classify a wrong-tree harness capture as a product failure.
- Preserve original cohorts, failures, fixture inputs and oracle defects beside
  later corrections. Record exact source hashes, profiles, versions, denominators,
  dirty-vs-frozen state and external-oracle availability. Unmeasured/unsupported
  cases and TODOs are not passes; scoped suites do not imply a current full gate.
- Segregate native oracle/input/captured data from canonical TypeScript inputs and
  test discovery by explicit data classification; preserve bytes and canonical
  source/test/helper coverage, not blanket exclusions or test waivers. Qualify each
  current candidate against its actual committed source/tests, authenticated
  prerequisites and tracked consumer inventory. Historical cohorts do not certify
  that candidate; an inventory is not proof that all TypeScript fixtures were checked.
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

- npm test runs node:test through tsx; npm run test:contracts targets contracts.
  npm run typecheck:all builds once, then checks source/tests and maintained strict
  consumers; npm run typecheck requires existing built declarations. Rebuild after
  source changes. Typechecking is not runtime or service acceptance. Captured-data
  exclusions must remain exact and authenticated, not broad test-tree omissions.
  npm run build emits ESM/declarations in dist.
  Run scoped checks first; do not rerun competing owners' entire suites needlessly.
- Inspect git root/status/index before changes. Use apply_patch, stage explicit
  owned paths and git commit --only with those paths. Preserve concurrent edits,
  staging and native temporary artifacts; never broad-stage or commit others' work.
- Never decode or dump resolved executables. Before text inspection, lstat and
  admit a bounded regular file of a recognized text type; hash necessary binary
  tool bindings with bounded streams. Use apply_patch through its patch interface,
  not binary inspection; editing tools are not executor inputs unless invoked there.
- Do not create branches or alter unrelated worktrees without instruction.
  Keep documentation corrections narrow and atomic; report checks and remaining
  limits without claiming superiority, universal parity or completion.
