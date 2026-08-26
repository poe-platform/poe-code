# Project Rules

## Authority and coordination

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
- Use `readBytes(source, signal)` and `writeBytes(sink, chunk, signal)` for command
  I/O that must stop waiting on cancellation. They observe late rejections;
  cancellation still cannot undo host side effects or interrupt synchronous work.
- `normalizePath`, `resolvePath`, and `relativePath` use virtual POSIX paths.
  `isPathWithin` and `assertPathWithin` are lexical containment helpers, not
  symlink security guarantees.
- Commands: `npm test` runs `tests/**/*.test.ts`; `npm run test:contracts` runs
  contract tests; `npm run typecheck` checks source and test types;
  `npm run build` emits ESM and declarations to `dist/`.
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

## Documentation ownership

- The initial documentation worker has finished. The user temporarily assigned
  the foundation worker `AGENTS.md` and `docs/PROJECT_LEDGER.md` to record the
  exact superiority requirement and established foundation evidence. This
  reassignment does not include `README.md` or other documentation.
- The oracle worker also owns `tests/fixtures/shell-cases.json`; do not edit it.
  Their assignment is at least 40 verified Bash fixtures tagged by feature as
  `core` or `advanced`. Track delivery and verification separately from intent.
- All edits for this documentation assignment must use `apply_patch`.
- Coordinate API details with foundation contracts worker Curie
  (`01a03f3d-492a-7e30-af3e-1e0e0e56f7e7`) before publishing API examples.
- The foundation worker owns contracts, root exports/configuration, benchmarks,
  and independent command verification. Exclude `src/commands/text-programs/**`
  and its tests (Plato), all adapters, `tests/stress/adapters/**`, and
  `tests/fs/conformance/**` (Faraday); coordinate later ownership transfers.
- Also exclude `src/commands/structured/**` and its tests (Poincare), and
  `benchmarks/shell-stress/**` (shell verifier). Use explicit-path `git commit
  --only` after staging owned paths so a concurrent worker's index entries do
  not enter another worker's commit.
