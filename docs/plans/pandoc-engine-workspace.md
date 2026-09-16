# Pandoc engine workspace task

Scope: `create-engine-workspace` only. Workspace/API implementation is locally
verified; package delivery remains incomplete until explicit README permission.
The pre-existing edits in `pandoc-typescript-safe-bash.md` are preserved and are
not staged. This owned record carries the task status and relevant plan update.

## Implementation boundaries

Create private `@poe-code/pandoc` with strict portable TypeScript ESM and explicit
exports. Share option/direction/capability/budget validation across read, write and
conversion. Convert owns independent input ordering, document aggregation, writer
invocation and awaited publication. Use explicit trusted reader/writer capabilities
for the minimal seam; do not fabricate or advertise a built-in parser.

Full AST constructor/geometry validation belongs to the next `document-ast` task.
Format implementations, wrapping/loss policy, ID/resource mapping, format-specific
budgets, root public bundle wiring and the thin safe-bash command are subsequent
tasks. Stable built-in descriptors keep all availability flags false. Hosts are
responsible for cooperative adapter work and atomic output publication.

## Executed QA procedure

1. Read root AGENTS.md, conversion contract/architecture and safe-bash AGENTS.md;
   inspect maintained sibling workspace declarations and build runner.
2. Write original public-consumer tests before implementation; run the package
   unit route and observe the absent public export failure.
3. Implement the bounded orchestration seam and run the consumer tests. Add
   original failing regressions for Buffer views, ignored options and resolved
   resource ownership, then fix those validated failures.
4. Run package unit and lint/typecheck routes and the selected maintained workspace
   build closure. Exercise built ESM exports by package name, with original
   in-memory adapters, separately from unit format-conformance claims.
5. Validate workspace build/test declaration discovery and inspect the lockfile
   diff. Run whitespace checks and stage only owned files and this plan record.

No visual CLI behavior changes, so screenshots are not applicable. Unit tests
create no host files and invoke no LLM, downloaded fixture or external executable.
No unit filesystem mutations are necessary. Evidence is in
`docs/pandoc/engine-workspace-evidence.md`; exact proposed README copy and the
unresolved permission gate are in `docs/pandoc/package-readme-draft.md`.

## Delivery

One atomic local implementation commit on main; no push or release authorized.
Do not mark the pipeline task done while its mandatory README gate remains open.
