# Safe Bash private publication boundary

The scoped release publishes only `@poe-platform/safe-fs`, `@poe-platform/safe-js`
and `@poe-platform/safe-bash`. Command workspaces remain private; the maintained
`safe-bash-command-private` package-lint rule rejects public command manifests.
Adding a command does not add a publication job or change default registration.

`scripts/package-safe.mjs` prepares advertised exports, rewrites private runtime
and declaration references into the artifact, and refuses leaked private package
requirements. `scripts/verify-safe-publication.mjs` independently verifies public
archive integrity, provenance source and installed identity, rejects bare private
command/engine/contract requirements, and checks Node imports and canonical
argument brands with an empty executable PATH.

## Maintained declarations

Legacy command bundles use the maintained `commandExportRecipes` declaration in
`scripts/safe-command-publication.mjs`. Each entry names an existing export route, its source and compilation
target. The output comes from that export's import target. Optional
`bundleDependenciesFrom` lists workspace directories whose non-root runtime
dependencies must be bundled; `require: true` supplies the ESM createRequire
compatibility banner. The recipe creates neither exports nor command registration.
The existing op/pandoc profiles retain their prior targets and dependency policy.
The recipe declaration leaves the guarded package manifest unchanged: a trial
manifest addition caused the committed-archive negative test to reject live/commit
metadata drift before its intended retired-export rejection. Moving the recipe
declaration into packing tooling preserves both checks and their ordering.

New private command workspaces use the qualified
`poeCode.integration.privateWorkspaces` profiles. Their ESM runtime entries share
the maintained private-command bundle recipe, while contract/value ownership
stays in one relative runtime graph. Declarations retain their relative closure.
Only the currently supported import profile is prepared; an unprepared browser,
workerd or require export condition is rejected rather than silently advertised.

The guarded declaration builder currently admits command and contract owners,
not an arbitrary private engine profile. A future shared parser engine therefore
still needs its planned declaration-admission gate; this task does not authorize
sibling source reads or advertise an engine that has not passed that gate.

A qualified private profile may declare `assets: ["./dist/path/to/file"]`.
Packing copies those explicit assets even when the runtime bundle does not import
them. Literal dist ownership, regular nonlink components and the owner's source
exclusions are checked before content reads. Missing, symlinked, excluded,
traversing and outside-dist assets fail packing. Assets keep their relative paths
under `dist/<workspace>/`. LICENSE and NOTICE files from qualified private owners
are retained there too, including owners whose source is bundled; a declared
license/notice file must exist. These paths belong to the safe-bash tarball's
existing `dist` inclusion.

Development tools and native reference controls are not runtime requirements.
The new command profiles have no external runtime dependencies. This is not a
claim that all legacy Safe Bash opt-ins have zero external dependencies: the
inspected prepared safe-bash manifest also requires pako, @noble/hashes,
@kayahr/text-encoding and jsonc-parser, plus @types/node for declarations and the
public safe-fs package.

## Installed-artifact evidence, 2026-09-19

Validation used the live checkout based on
`35d01c57f8078d8afa916dc59929395d857e9c55`, including pre-existing uncommitted
integration changes, with Node 22.22.2 and npm 10.9.7. This is live-tree evidence,
not a committed-archive certification or a verified remote release.

- The maintained selected-workspace build closure for
  `@poe-platform/safe-bash` passed, including the guarded source/declaration builder
  and optional CLI postbuild. Existing exclusions, held paths and archive gates
  were preserved.
- Eight focused publication/build/lifecycle suites passed: 293 tests. The
  package-lint workspace passed 545 tests, and all 18 package-lint rules passed.
- The final maintained `npm test` route exited successfully, including workspace
  pre/post scripts and root posttest lint-stress checks. Safe Bash reported
  41,882 passed, zero failed and 829 skipped; Safe JS reported 31,121 passed and
  48 skipped; Safe Python reported 84,595 passed. Skipped cases and the unavailable
  optional isolated comparator do not count as compatibility passes. Native
  controls retain their reported historical differences and parity limits.
  The earlier full run rejected the trial manifest change at the archive gate
  and invalidated a shell result when that manifest changed during execution.
  After moving the recipe declaration, both focused cases passed and the complete
  archive regression passed 224 tests with unchanged guards and assertions.
  The successful full rerun held source stable throughout execution.
- `npm run lint:workflows` passed after adding installed private-command
  runtime/types and independent browser/workerd graph checks to release-safe.
  No workflow unit tests or publication jobs were added.
- Repository type lint passed, including the safe-js and tiny-mcp-client consumer
  contract matrices. Guarded repository ESLint completed with zero errors and four
  unsuppressed warnings; its final receipt reported 16,040 configured inputs linted.
- Prepared artifacts were packed at the local-only version
  `0.0.0-publication-boundary`. The tarball inventory contained required private
  command and contract runtime/declaration entries and each owner's LICENSE.
- A fresh npm consumer outside the checkout installed only the three tarballs
  and their declared public dependencies, with scripts disabled and workspace
  resolution disabled. Its lock contained no private command, engine or contract
  package. The private-command fixture passed in ordinary Node with an empty PATH.
- The installed private-command TypeScript consumer passed strict NodeNext checks,
  including exact optional properties and unchecked indexed access. The installed
  registration fixture also passed collision/replacement, unchanged default
  inventory and script-file invocation checks for both private commands.
- Browser and workerd conditions were bundled independently from the installed
  consumer, each with 95 input modules for both command graphs. Both ran in Buffer/process/require-free
  VM contexts and preserved constructor identity, WeakSet carrier admission,
  WeakMap byte ownership, distinct invalid-byte arguments and copied-byte
  isolation. The fixture also exercised Shell invocation and PNG metadata reads.
  The renderer command's help path exercised canonical Shell invocation without
  a native renderer or an implicit renderer binding.
  Injected TextEncoder and byte constructors use a matching realm; the initial
  mismatched VM setup failed and was corrected without changing runtime code.
  These are graph and portable-API checks, not execution in a native workerd host.

All 16 command plans and the PDF/parser/package gates remain intact. PDF parser
work remains sequenced through metadata before text/layout before lossless
transformations. No external parser, native utility or model asset dependency was
adopted. Temporary tarballs and consumers are removed after validation; `/out` was
read-only on this host, so the ignored workspace `out` directory held local
artifacts during the checks.

## Publication-boundary follow-up verification

The follow-up audit reproduced one additional failure path with a memfs test:
packing previously succeeded when a qualified profile declared an explicit asset
but its private workspace was absent. Packing now validates that owner before
processing each declared asset and rejects the missing workspace. Profiles with
no assets retain their existing admission behavior. No command implementation,
default registration, export, source exclusion or archive guard changed.

The regression failed before the fix and passed afterward. All four affected
publication suites passed 220 tests; the broader initial eight-suite check passed
334 tests, and package-lint passed 545 tests and all 18 maintained rules. The
selected safe-bash workspace build closure and focused ESLint passed.

Fresh local tarballs at `0.0.0-publication-boundary-audit` installed in a temporary
consumer outside the checkout with scripts and workspace resolution disabled.
Its lock contained no private command/engine/contracts package. Empty-PATH Node
checks passed command invocation, registration and ordinary imports; strict
NodeNext declaration consumers passed. Installed runtime/type entries and
private owner licenses were present. Browser and workerd conditions each bundled
95 installed graph inputs and passed independently in a realm without Buffer,
process or require, including canonical constructors, carrier identity and copied
byte ownership. These are portable graph checks, not native workerd execution.
The legacy artifact still declares its existing public/external dependencies;
this audit does not claim the entire safe-bash artifact has zero dependencies.

This is local live-tree verification. No commit, push, publication or remote
release was performed by this follow-up audit. `/out` remained read-only; packing
scratch used ignored workspace `out`, and the external consumer was removed.

The final maintained `npm test` route passed, including declared workspace unit
tasks, their native lifecycle scripts and root posttest lint-stress checks. Safe
JS reported 31,121 passes and 48 skips; Safe Python reported 84,595 passes.
Repository-wide `npm run lint` also passed, including type consumer matrices and
workflow lint, with zero ESLint errors and four warnings outside this follow-up's
code changes. The task-owned packing scratch was removed after verification.
