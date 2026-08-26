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
- Build tools sequentially, then run independent stress-test/fix cycles.
- The user explicitly requested **WORK 72 hours**. Record actual work and
  remaining scope; do not claim this duration or completion without evidence.
- Initialize Git and make atomic commits. Git is already initialized as of the
  initial documentation inspection; do not reinitialize it unnecessarily.
- Stage explicit owned paths only. Do not include another worker's changes in
  a commit or alter their files without a revised ownership assignment.

## Architecture and commands: intended versus established

- Intended foundation: TypeScript, ESM, Node.js 22 contracts. The foundation
  worker is building these; this is not evidence of verified APIs or behavior.
- At the initial inspection on 2026-08-26, the repository contained only `.git`
  and had no commits. No source, package scripts, or tests were established.
- Until implementation is inspected and validation succeeds, do not document
  proposed exports, plugin signatures, installation steps, or test commands as
  working. Update the README and ledger when concrete evidence is available.
- Document verified code conventions and commands here when established;
  keep planned acceptance gates distinct from recorded test results.

## Documentation ownership

- This worker owns `AGENTS.md`, `README.md`, and `docs/**`, except
  `docs/testing-shell-oracle.md`, which belongs to the separate oracle worker.
- The oracle worker also owns `tests/fixtures/shell-cases.json`; do not edit it.
  Their assignment is at least 40 verified Bash fixtures tagged by feature as
  `core` or `advanced`. Track delivery and verification separately from intent.
- All edits for this documentation assignment must use `apply_patch`.
- Coordinate API details with foundation contracts worker Curie
  (`01a03f3d-492a-7e30-af3e-1e0e0e56f7e7`) before publishing API examples.
