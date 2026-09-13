# PPTX relationship graph implementation and QA

Scope: the `opc-relationships` task only. Own `packages/pptx/src/relationships.ts`,
its original unit tests, this plan and `docs/pptx/relationship-case-map.json`.
Preserve the already modified overarching pipeline plan and other work.
No safe-bash files or root exports are changed; no adapter delegation is needed.

## Contract and implementation boundary

Follow F02/F08 of `docs/specs/pptx.md`, shared office CLI/SDK contracts and root
AGENTS.md. The package's existing unexported packaging layer gains bounded XML
relationship admission, source-local edges, canonical resolution, reverse lookup,
visited-set closure and isolated graph import/remapping. Package ZIP streams are
indexed without treating relationship streams as ordinary parts. Dangling edges
remain inspectable; dependency traversal fails when it reaches a missing target.
External targets are retained literally and never resolved or fetched.

Import reserves all incoming noncolliding names before generating `-importN`
suffixes, retains IDs because each imported owner is distinct, and rewrites only
internal target references. It returns a new relationship graph plus a part-name
mapping. This does not copy part payloads, serialize modified relationship XML,
rewrite content types or implement presentation slide merge. Those are later tasks.
Prefix conflicts fail safely rather than publishing an invalid graph.

These are internal immutable packaging data structures, not replacements for
live documented model objects. No public model member is reclassified by its
spelling. JS arrays/Maps replace private reference-runtime collection machinery;
external edge `targetPart` is explicitly null. Public target-part access errors,
get-or-add, ID allocation, serialization and model ownership remain obligations
in the existing complete API/test ledgers. Bounded synchronous indexing does not
establish cooperative asynchronous scheduling of future whole-deck operations.

No CLI route or public export currently exposes this layer. Paired model/CLI
acceptance, schemas/capabilities and screenshots remain pending adapter/model
work; this task changes no visible CLI. No SDK or CLI parity claim is made.
No README edits, native product runtime, ambient I/O, network, or reference assets.

## TDD and maintained verification

1. Write original memfs/in-memory cases with literal independently expected edges,
   closures and remappings. Run maintained package unit tests to demonstrate the
   absent module failure before implementation.
2. Implement graph behavior. Add package-stream and reserved/prefix/root-import
   regressions; observe their failures before implementing those admissions.
3. Run `npm run test:unit --workspace=pptx`, `npm run lint --workspace=pptx`,
   `npm run build:workspaces -- --workspace=pptx`, and scoped Prettier checks.
4. Review owned diff and stage only explicitly named paths. Make one Conventional
   Commit on main after passing checks. Do not push or release.

## Disposable corpus QA procedure

1. Select only the first manifest-listed document in
   `docs/pptx/corpus-manifest.json`. Verify its cached bytes against the recorded
   SHA-256; use existing local bytes, no acquisition or downloads.
2. Supply those bytes explicitly to `readPackage` and the relationship index.
   Use archive bounds of 256 MiB compressed, 256 MiB per member, 1 GiB expanded,
   50,000 members; relationship bounds of 32 MiB total XML, 50,000 parts and
   5,000,000 edges. This is structural QA, not rendering or slide model validation.
3. Compare total/external edge counts to the prior independent manifest census.
   Traverse from the package root, enumerate dangling edges, and record counts.
4. Do not mutate, redistribute or delete the shared corpus input. Reduce any
   meaningful mismatch into a tiny original regression before fixing it.

## Evidence

Verified 2026-09-13. The maintained package unit route passed all 289 cases;
23 are new relationship cases (including three target-mode parameter variants).
Focused ESLint, production/test TypeScript checks and the declared workspace
build closure passed. The closure rebuilt office-package and pptx; no full
pipeline, root-wide build/test or release was executed for this package-local task.
Scoped formatting and Git whitespace checks pass.

The corpus file matched SHA-256
`885e923f148cdf4680372abe54496c824ab3a2a2d8a59fd9703d66e0aeb1164c`.
Its 34 relationships and zero external relationships matched the independent
manifest census. All 23 ordinary parts were root-reachable; zero dangling edges.
No mismatch or new corpus regression was found. No visual/application QA or
corpus mutation/cleanup occurred.

Full source case accounting remains in `docs/pptx/test-case-map.json`.
The task supplement explicitly tracks 62 relationship-related unit identities:
4 adapted behaviors, 6 adapted internal behaviors, 3 partial and 49 deferred
model/collection/serialization cases. The external-link BDD scenario has original
packaging-layer evidence, but remains partial pending the presentation API and
CLI. All other 2,700-unit/973-BDD baseline rows retain existing dispositions.
No full public API or relationship-editing parity is claimed.

Only the four owned files listed above belong to this atomic local commit.
No push or release is authorized; the commit hash is reported separately.
