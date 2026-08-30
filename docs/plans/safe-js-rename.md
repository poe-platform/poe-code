# SafeJS canonical package rename: implementation map

## Status and authorization boundary

Current status (August 30, 2026): the isolated rename is reconciled with published
C `poe-code@12.0.7`, commit `a21b09b450739d2ccfc44a1a17770fd86785d7e4`, whose
release coordinator verified workflow `33300282777`. The authorized successor
archive SHA-256 is
`33342f4ce1bc735f42b24aceac678f41c1db81b05fc1c3cb17bd8c8292dd4e76`.
All 4,058 manifest entries and four separately inventoried font assets match.
The exact two-file compiler-lazyload successor is included, preserving the rename
policy changes in the overlapping file. Earlier archives, receipt discrepancies,
and red controls remain evidence, not replacements for this successor baseline.
The release coordinator must preserve any post-C documentation paragraph increment
and run final gates on the fresh remote base. No live relocation, commit, push, or
publication is performed by this leaf. The original survey below is historical,
not a description of this expanded isolated grant.

### Original planning authorization (historical)

Planning only. The requested canonical names are `packages/safe-js`,
`@poe-code/safe-js`, `poe-code/safe-js`, and `poe-safe-js`. No directory move,
production edit, source execution, install, build, skill sync, commit, push, or
release is authorized by this document. Only this new plan is writable now.

All CLI/config/export/README files from the filesystem configuration slice are
frozen. Halley owns active runtime/registry/interpreter/job/value/resource work;
Bohr owns browser boundaries; Turing owns bundle/manifest/lint/smoke and the
proposed SafeJS filesystem cwd/signal integration; Lorentz owns foundation work.
Their current source and plans must remain untouched. Reconcile their accepted
freezes before proposing production file ownership. Do not move a directory
while any of those owners is writing within it or depending on its paths.

This is a read-only map of the working tree, not a claim that its uncommitted
features have shipped. The coordination update takes precedence over older
status text in other plans. Preserve `docs/plans/safe-fs-and-safe-js.md`,
`docs/plans/safejs-explicit-execution-context.md`, and the other owners' plans.

## Frozen configuration handoff

Audit directory: `/tmp/poe-fs-config-frozen.wpcOaX`.

- `changed-files.txt` is the exact 14-file scope below.
- `SHA256SUMS` records SHA-256 for each complete file at freeze. Its own SHA-256 is
  `48e4dfa066dce0c2724707ee90d2dcf6cff7670104a659c9eb93c660cd037f66`.
- `head.txt` records the repository revision. Whole-file hashes and
  `tracked-at-freeze.diff` include preserved baseline WIP; they do not claim
  authorship of every existing change in those files.
- `safe-fs-index.incremental.patch` contains only the seven appended export
  lines; the preexisting export bytes were checked unchanged.
- Original baseline and validation evidence remain at
  `/tmp/poe-cli-fs-production-baseline.UNHTT5`: `tracked.diff`,
  `safe-fs-index.before.ts`, `runtime-frozen-final.json`,
  `types-root-export.log`, `safejs-help.png`, and `harness-help.png`.
  That validation passed 273 focused tests and scoped type diagnostics for 13
  files, using frozen filesystem/runtime inputs and live-import guards. It is
  not rename validation, a full build, or proof against subsequent owner edits.
- `rename-reference-files.txt` is a static reference inventory, not another
  frozen production scope.

Exact changed files:

```text
packages/safe-fs/src/config.ts
packages/safe-fs/src/config.node.ts
packages/safe-fs/src/config/memory.ts
packages/safe-fs/src/config/real.ts
packages/safe-fs/src/index.ts
packages/safe-fs/tests/config.test.ts
packages/safejs/src/modules/fs-config.ts
packages/safejs/src/modules/fs-config.test.ts
packages/safejs/src/index.ts
packages/safejs/src/cli.ts
packages/safejs/src/cli.fs-config.test.ts
packages/safejs/README.md
src/cli/commands/harness.ts
src/cli/commands/harness-fs-config.test.ts
```

The rename must preserve the frozen config contract, validation order, registry
extension/duplicate rejection, and legacy `--fs-root`/worktree behavior. It does
not authorize a cwd/signal option, extra adapter discovery, or new browser access.

## Minimum backward-compatible layout

One private workspace package, one source tree, one canonical public bundle
family. Do not create a second workspace, copied engine, old-directory symlink,
alias-specific registry, CLI wrapper, or separately compiled compatibility entry.

```text
packages/safe-js/
  package.json                 name: @poe-code/safe-js; private remains true
  src/                         the moved, reconciled source tree
  dist/
    index.js / index.d.ts       Node SDK entry
    core.js / core.d.ts         existing core contract, subject to Bohr's freeze
    cli.js / cli.d.ts           Node CLI entry
    safe-fs.js                 canonical shared filesystem runtime facade
    chunks/                   shared reachable bundle chunks and maps
packages/safe-fs/dist/
  index.d.ts and dependencies  existing canonical filesystem declaration tree
```

This shows public roots, not an exhaustive artifact allowlist. Keep every
required declaration, reachable dependency, map, and approved asset.

Proposed root `package.json` mappings:

| Public specifier(s) | `import` target | `types` target |
| --- | --- | --- |
| `poe-code/safe-js`, `poe-code/safejs` | `./packages/safe-js/dist/index.js` | `./packages/safe-js/dist/index.d.ts` |
| `poe-code/safe-js/core`, `poe-code/safejs/core` | `./packages/safe-js/dist/core.js` | `./packages/safe-js/dist/core.d.ts` |
| `poe-code/safe-js/cli`, `poe-code/safejs/cli` | `./packages/safe-js/dist/cli.js` | `./packages/safe-js/dist/cli.d.ts` |
| `poe-code/safe-fs` (unchanged specifier) | `./packages/safe-js/dist/safe-fs.js` | `./packages/safe-fs/dist/index.d.ts` |

Each old/new export pair must contain exactly equal target strings and equal
condition trees, not re-export files. Retain the old public SDK paths, including
`/core` and `/cli`, without a removal date or an assumed deprecation deadline.
If Bohr adds approved conditional exports before the rename, preserve them under
both spellings; do not invent browser conditions during this rename.

Root bins both target `packages/safe-js/dist/cli.js`:

```json
{
  "poe-safe-js": "packages/safe-js/dist/cli.js",
  "poe-safejs": "packages/safe-js/dist/cli.js"
}
```

The renamed workspace manifest likewise declares both bin names as `dist/cli.js`.
Its `main`, `types`, and relative `.`/`./core`/`./cli` targets remain relative to
that same workspace. Root `files` replaces `packages/safejs/dist` with
`packages/safe-js/dist`, preserving the safe-fs declarations allowlist and all
unrelated entries. Do not pack an obsolete old-path output tree.

`@poe-code/safejs` is currently a private workspace dependency. The minimum
proposal migrates all in-repository consumers atomically to `@poe-code/safe-js`;
it does not publish a compatibility package or promise the private old name as
a public import. Confirm this distinction during production authorization. An
additional private-name compatibility requirement needs a separately reviewed
single-target resolution design, not another package copy.

### CLI help and SDK consistency

The current `createUsage()` in `packages/safejs/src/cli.ts` hardcodes
`poe-safejs`; `isDirectExecution()` compares the real paths of `process.argv[1]`
and `import.meta.url`, already supporting normal installed bin symlinks.

Propose canonical `Usage: poe-safe-js ...` for **both** bin spellings and direct
SDK `runCli(["--help"], ...)`, plus one help note that `poe-safejs` remains a
supported alias. No argv-basename dispatch, alias-specific warnings on normal
runs, or wrapper executable. Keep exit codes and machine-readable stdout equal.
`poe-code harness run` keeps its existing command name and the same SDK helpers.

Examples use `poe-safe-js` and `poe-code/safe-js`; workspace source imports use
`@poe-code/safe-js`. Do not expose internal workspace names in installed-consumer
examples. Both public spellings expose the same `parseFsConfig`, `resolveFsConfig`,
`makeFsModule`, and existing runtime APIs. `.safejs` and `.ajs` stay valid script
extensions; this package rename does not add or require `.safe-js` files.

## Actual reference and tooling map

Paths here are the current pre-rename paths. Re-inventory after owner freezes;
do not use this list to overwrite concurrent additions.

### Source imports and tests

These consumers contain actual `@poe-code/safejs` imports, type imports, or mocks:

- `src/cli/commands/harness.ts`, `harness-command.test.ts`, and
  `harness-fs-config.test.ts` in that directory. The latter also mocks
  `../../../packages/safejs/src/modules/fs.js` and `modules/fs-config.js`; move
  those relative specifiers together with the public-package mock.
- `packages/agent-harness/src/loader/run.ts`, `run.test.ts`,
  `agent-results.test.ts`, `extract-schema.ts`, `extract-schema.test.ts`, and
  `mcp.test.ts` in that directory.
- `packages/agent-harness/src/modules/schema.test.ts`,
  `packages/agent-harness/src/templates/index.test.ts`, and
  `packages/agent-harness/src/testing/replay-equivalence.ts`.
- `packages/toolcraft-codemode/src/execute.ts`, `execute.test.ts`, and
  `host-modules.test.ts` in that directory, specifically the `/core` path.

Within the moved package, `src/cli.test.ts` asserts literal usage text, and
`src/index.test.ts` names the package's public-export suite. Keep the CLI's
filesystem config tests and SDK-export tests with the moved source. Most local
relative imports, including `../safe-fs` sibling relationships at equal directory
depth, do not change. No runtime implementation or public function/type identifier
rename is required.

Not every matching test string is an import: the rejected `harness new safejs`
kind in `src/cli/commands/harness-command.test.ts` and the forbidden `safejs`
export in `packages/safe-fs/tests/public-imports.test.ts` are negative contract
cases, not branding substitutions. Preserve them unless a distinct API change
is approved. Preserve `packages/safe-fs/PROVENANCE.json` source paths and hashes:
they describe the extraction origin, not this package's current import path.

### Manifests, lockfile, TypeScript, Vitest, Turbo

| File(s) | Required treatment |
| --- | --- |
| Root `package.json` | Add canonical public exports/binary; retain old public aliases to identical new targets; move files target and workspace devDependency; retarget `./safe-fs` runtime only. |
| `packages/safejs/package.json` | Move to `packages/safe-js/package.json`; change workspace name, add canonical bin while retaining old bin, and update explicit test/adversarial command paths. Keep private/version/dependencies and env names. |
| `packages/agent-harness/package.json`, `packages/toolcraft-codemode/package.json` | Change dependency key to `@poe-code/safe-js`; preserve unrelated metadata and ranges. |
| `package-lock.json` | Reconcile root devDependency/bin metadata, `node_modules/@poe-code/safejs` link and resolved directory, workspace package key/name/bin, and both dependent workspace dependency records. Use the approved lockfile workflow later; do not hand-rewrite unrelated resolutions/integrities. |
| `tsconfig.json`, `tsconfig.build.json`, moved package `tsconfig.json` | Current includes and relative extends are generic; no name-specific replacement is needed. Verify declaration resolution after the move instead of adding redundant paths aliases. |
| `vitest.config.ts` | `getPackageAliases()` discovers directory and manifest names and exported subpaths; the new private name/core/cli aliases should be derived automatically. Do not add public old/new aliases that hide broken packed manifests. |
| `turbo.json` | Workspace manifest discovery, `^build`, generic `dist/**`, and package inputs already cover the renamed directory. No new per-name task. Audit cache restoration under the new workspace identity later. |
| `eslint.config.js` | Retarget the literal `packages/safejs/src/interp/arguments.ts` scoped rule path, retaining the rule itself. |

JSON edits must preserve unrelated fields through parsed structural updates, not
regex replacement. The old directory must not remain as a manifestless folder
under `packages/`: the bundle workspace scan reads each directory's manifest.

### Build, bundle policy, cleanup, release, smoke

- `scripts/bundle.mjs` hardcodes the SafeJS package guard, source roots
  `index/core/cli`, shared outdir, publication path, and chmod package path.
  Retarget all to `packages/safe-js`. Keep `canonicalFs.source` as the fourth
  entry in the **same** splitting build. The final `canonicalBundle` metadata
  must describe the new paths; do not create an old-name second build.
- `packages/package-lint/src/bundle-policy.ts` defines
  `canonicalFs.runtime = "packages/safejs/dist/safe-fs.js"` and enforces the
  `packages/safejs/dist/` reachable-output prefix. Both must move in lockstep
  with root `./safe-fs`. Keep the workspace/specifier/source/types identities
  for safe-fs unchanged and retain foreign-engine-input rejection.
- `scripts/bundle.test.ts` and
  `packages/package-lint/src/rules/bundle-self-contained.test.ts` contain concrete
  old output/fixture paths, chunk paths, manifest names, and input paths. Update
  their owning fixtures and add identity/path-escape counterexamples rather than
  weakening reachability, purity, or duplicate checks.
- `scripts/bundle-graph.mjs` derives private aliases from workspace manifests.
  `scripts/bundle-graph.test.ts` should verify canonical renamed discovery and
  retained safe-fs consumer externalization. No backend/name dispatch is needed.
- `scripts/guard-package-dist.mjs`, `scripts/publish-bundle.mjs`, and their tests
  are package-directory-driven, not SafeJS-name-driven. Keep their safety
  algorithm; exercise new-path fixtures as needed. Publication stages bytes,
  publishes dependencies before entries, then prunes stale JS chunks/maps. It
  does **not** archive an old package directory or make a cross-directory rename
  transactional. Do not claim either property.
- `scripts/set-bin-executable.mjs` is manifest-driven; both names already select
  the same target without new wrapper logic. `scripts/generate-bin-wrappers.mjs`
  currently generates the unrelated `poe-agent` wrapper: no SafeJS addition.
- `scripts/bundle-assets.mjs`, `scripts/manage-bundled-workspace-deps.mjs`, and
  `scripts/prepare-lockstep-release.mjs` have no observed literal old-name
  wiring requiring a rename edit. Review their derived outputs after the move,
  without widening their implementation scope.
- `tests/integration/standalone-package-metadata.test.ts` asserts the complete
  root exports/bin lists and the old package branding/path. Update it to assert
  both public spellings, exact target equality, one new private workspace name,
  and exclusion of the old artifact directory.
- `scripts/smoke-test.ts` invokes `poe-safejs --help`, imports all three public
  SDK paths, compares root/core `run`, and checks canonical safe-fs runtime and
  types. Extend the existing installed-consumer smoke to canonical names **and**
  retained aliases in the same process, preserving its NodeNext/Bundler checks.
  Do not substitute workspace aliases for the installed-package evidence.
- `scripts/record-fs-conformance.ts` imports the old package's conformance cases
  and names its truth JSON output. `.github/workflows/record-fs-conformance.yml`
  hardcodes the old test and uploaded artifact paths. Move those paths, not the
  conformance data or protocol. Use workflow lint, not workflow unit tests.
- `.github/workflows/release.yml` runs the generic root clean-install, build,
  signature audit, package lint, tests, smoke, and semantic-release pipeline;
  it has no observed SafeJS path literal to replace. Continue the existing root
  release route described in `docs/development/NPM_PUBLISHING.md`. Neither the
  renamed private workspace nor an alias requires a new publication workflow.
  This phase authorizes no invocation of that pipeline.

## Branding, templates, and data that must remain stable

| Category | Proposed handling |
| --- | --- |
| Active package docs | Update the moved package's `README.md`, `ENV.md`, `MCP.md`, `RECOVERY.md`, `MIGRATION.md`, `CHECKPOINT_REPLAY.md`, `MARKDOWN_SCRIPTS.md`, `AGENT_RESULTS.md`, and executable examples only where they contain live package/bin/path references. Check local links after relocation. |
| Active consumer docs | Review root `README.md`, `packages/agent-harness/README.md`, and `packages/toolcraft-codemode/README.md`; repair `../safejs/...` links and use new public examples with an explicit retained-alias note. Do not rewrite unrelated claims or mark unfinished browser work complete. |
| Skill source | Move `packages/safejs/src/templates/skill/SKILL_safejs.md` with the package; update its command examples to `poe-safe-js` and add the new search spelling. Keep `SKILL_safejs.md` and frontmatter `name: poe-code-safejs` initially so existing installed skill directories update in place. Skill-slug migration is not among the requested canonical names. |
| Skill outputs | `scripts/sync-skills.ts` discovers `**/SKILL_*.md`; no directory-name routing change is needed. After separate execution authorization, run `npm run sync-skills` and review only generated changes. Never hand-edit generated `.codex`, `.claude`, `.agents`, or home skill copies. Sync can write global and existing local skill directories; preserve its symlink guards and do not delete old slugs. Postinstall uses the same sync path. |
| Brand/API identifiers | Keep the display brand `SafeJS`, types such as `SafeJSSnapshot`, and existing function/error names. Package hyphenation is not a type or language rename. |
| Executable filenames/env | Keep `.safejs`, `.ajs`, `SAFEJS_ADVERSARIAL_SLOW`, `SAFEJS_PARSE_FUZZ`, and other documented environment variables. Do not rename source fixtures just to remove the substring. |
| Serialized/protocol strings | Keep snapshot format/version/semantic markers, replay tags, symbol descriptions, and serialized field names. At inspection `src/snapshot/dump-format.ts` contains version `1` and `jobs-v8`; preserve the owners' eventual accepted baseline rather than resetting it to this observation. Keep MCP client identity `safejs`/version `1` and `.safejs-migration-` temporary naming unless separately approved. |
| History and provenance | Do not mass-edit `docs/plans/archive/**`, `docs/archive/**`, research audit reproductions, release evidence, historical package paths, commit IDs, old CLI transcripts, or `packages/safe-fs/PROVENANCE.json`. Preserve existing plan filenames, including `safejs-*`. An owner may later repair an active navigation link without rewriting its historical evidence. |

No broad search-and-replace across `safejs`, `SafeJS`, `agent-script`, snapshot
fixtures, old extraction paths, or generated output is permitted. A final search
must classify intentional remaining matches, not demand zero matches.

## Concrete implementation sequence after authorization

1. **Owner barrier and new baseline.** Obtain accepted Halley/Bohr/Turing/Lorentz
   freezes and explicit rename authorization. Capture tracked and untracked
   source, manifests, lockfile, relevant outputs, symlink metadata, and hashes.
   Reconcile this map with newly accepted exports/browser conditions/cwd-signal
   contracts. Do not run a live mutable-engine reader to obtain a baseline.
2. **Behavioral red.** Add bounded metadata/alias/help tests in their owning
   groups, using existing memfs patterns and mocks/frozen runtime where needed.
   Assert missing canonical mappings and target inequality as behavior, not
   merely an unresolved new import. Do not install/build to manufacture red.
3. **Archive and relocate once.** Archive old generated outputs and their
   metadata with a verified content inventory. Quarantine the original old
   `dist` generation outside scanned `packages/` without deleting it or following
   unsafe symlinks. Then move the reconciled source package once to
   `packages/safe-js`; preserve every tracked/untracked source byte except the
   approved content edits below. Do not leave a second old manifest or an
   old-directory compatibility symlink. Keep the tree non-runnable until all
   coordinated manifest/import/tooling groups are applied.
4. **Apply disjoint content groups.** Update manifests, consumers/help, packaging
   paths/tests, then active docs/template examples. Check staged diffs against
   the baseline, not just against HEAD. No behavior refactor accompanies the
   move. Use existing parsed config workflows and generators, not regex edits or
   a new discovery/generation framework.
5. **Authorized validation.** Run focused tests first; then let the designated
   integration owner authorize lock reconciliation and clean/forced/cached
   builds in an isolated copy. Verify manifest-derived aliases and generated
   declarations before installed-consumer smoke. Do not execute a repository
   install/postinstall or global skill sync implicitly. A production release
   gate can run the repository pipeline later; this plan does not authorize it.
6. **Artifact acceptance, then cleanup.** Accept verified canonical outputs and
   packed old/new entry identities before deleting any quarantined obsolete
   generation. Keep the verified archive. Prune only inventoried generated
   outputs, with containment/symlink checks and no active builders. Recheck
   packlist, maps, declarations, chmod, cache restoration, and protected assets.
7. **Coordinated release, separately authorized.** Commit only assigned files
   and this plan when requested; no history rewrite, new branch, local publish,
   or bypassed hooks. If a push is authorized, use the existing root release and
   monitor it to success; verify the installed published aliases before calling
   the rename shipped. Do not schedule removal of the old public names.

### Disjoint write groups

These are proposed assignments, not current grants. Relocation is a serial
namespace operation, not a parallel writer over every owner's files. All content
groups start only after the relocation barrier, with one writer per listed file.

| Group | Exclusive content scope after relocation |
| --- | --- |
| R — relocation coordinator | Move the reconciled `packages/safejs` tree once; inventory/archive/quarantine only. No simultaneous content authoring and no rewriting the owners' runtime implementation. |
| M — manifest/lock owner | Root `package.json`, `package-lock.json`, new `packages/safe-js/package.json`, `packages/agent-harness/package.json`, `packages/toolcraft-codemode/package.json`. Own all alias/condition-tree/lock edits in those files. |
| C — consumer/CLI owner | The source imports/mocks listed under “Source imports and tests”; moved `src/cli.ts`, `src/cli.test.ts`, and the package label in `src/index.test.ts`. No runtime ownership, browser-service, filesystem adapter, config-helper, or registry implementation edits. |
| B — build/policy/test owner | `scripts/bundle.mjs`, `scripts/bundle.test.ts`, `scripts/bundle-graph.test.ts`, `packages/package-lint/src/bundle-policy.ts`, `packages/package-lint/src/rules/bundle-self-contained.test.ts`, `tests/integration/standalone-package-metadata.test.ts`, `scripts/smoke-test.ts`, `scripts/record-fs-conformance.ts`, `.github/workflows/record-fs-conformance.yml`, `eslint.config.js`. Own any justified new-path fixture additions in guard/publication/bin tests. Generic TS/Vitest/Turbo/build-graph/release implementations are review-only unless a specific gap is separately authorized. |
| D — active docs/template owner | Only the active docs/examples/template listed above, plus this plan's implementation status. No generated skill edits, archived research/history rewrites, or other owners' active plan edits. Obtain explicit README authorization for these rename paragraphs. |
| V — integration verifier | No production source scope. Hash/pack/installed-consumer/cache/screenshot evidence in a temporary isolated environment after execution authorization; permanent conclusions in this plan through its owner. |

Groups M and B must agree on target strings before editing but do not share file
ownership. No group may use a whole-file replacement that discards baseline WIP.

## Acceptance cases to author before production changes

These are future cases, not results from this planning pass.

1. **Manifest identity:** all three old/new public export pairs have byte-equal
   import/type target strings and equal conditions; both bins have the same
   target in root and workspace manifests. Root files include new outputs and
   exclude obsolete old outputs. Workspace name/dependency/lock links are
   canonical; unrelated public surfaces and dependencies are unchanged.
2. **ESM identity:** in one installed consumer, importing old/new SDK roots gives
   the same module namespace; repeat for `/core` and `/cli`. Root/core `run` and
   `Budget` retain their intended shared identities. `runCli`, `makeFsModule`,
   `parseFsConfig`, and `resolveFsConfig` are strictly equal between spellings.
   Importing either CLI subpath must not execute the CLI.
3. **Types and state:** NodeNext and Bundler consumers import both spellings
   without workspace aliases, casts, `any`, or skipped declaration errors to
   conceal incompatibility. A Budget created via one spelling works via the
   other. Test any approved registry/policy handle through both imports to catch
   duplicate state, using the owners' accepted API rather than reintroducing
   global execution context. Check cross-alias error constructor identity.
4. **Filesystem identity:** retain `poe-code/safe-fs` constructor/error identity
   across consumer imports and the canonical bundle graph. Pass one explicitly
   created memory adapter through both SDK spellings and observe shared state;
   do not incorrectly require two factory calls to return the same instance.
   Exercise caller descriptor extension and duplicate rejection through both
   helper imports; no Node defaults enter portable generic config.
5. **CLI parity:** both installed bin symlinks execute the same target, show
   canonical help and the alias note, and produce matching output/exit codes for
   valid scripts, missing arguments, invalid config, and migration help. Compare
   direct SDK `runCli` help. Exercise `--fs-config`, conflicts with legacy flags,
   host-root/virtual-root separation, and legacy worktree mapping without
   adding new backend branches or cwd/signal flags.
6. **Build graph and packlist:** one new-path shared entry family; no emitted
   alias engine, duplicate registry, private workspace runtime external, or
   old-path JavaScript/declaration/map in the installed package. Canonical
   safe-fs metadata still rejects foreign engine inputs and missing/unpacked
   dependencies. Test compile failure before publication, partial publication,
   stale chunks, forced rebuild, and cache-hit restoration with existing bounded
   memfs tests plus later isolated integration evidence.
7. **Browser boundary:** preserve Bohr's accepted core entry/conditions and full
   language engine. Verify reachable imports, not names alone: portable entries
   must not gain Node CLI/default-registry/host-directory imports. Current Node
   SDK and CLI aliases remain Node entries; renaming does not make them portable
   or emulate host directory access in a browser.
8. **No data migration:** pre-rename compatible snapshot fixtures restore through
   both names under the same accepted execution semantics. No marker bump,
   snapshot rewrite, `.safejs` rejection, env rename, or implicit MCP identity
   change is allowed as a consequence of package naming.

### Manual acceptance and protected cleanup

After execution authorization, inspect screenshots of both bin help pages and
`poe-code harness run --help`; compare SDK and CLI examples and their paths.
Use the existing smoke/metadata checks rather than creating a standalone QA
script. Unit filesystem changes stay in memfs; real disk/package/bin checks
belong to the authorized isolated integration stage.

Before and after cleanup, compare the protected font files under
`packages/terminal-png/assets/` and `packages/terminal-pilot/assets/`, unrelated
assets, and symlink inventories. Never use a root-wide dist deletion, follow an
escaping/dangling output symlink, remove user files, or change font content/modes
to make a build pass. Validate containment for both old and new locations;
archiving alone is not permission to delete. Keep old artifacts until the archive
and new canonical output inventory are verified. No build/publisher can race the
move or cleanup, and no cross-directory transactional guarantee is claimed.

## Production approval checklist

- Accept the one-workspace/one-artifact layout and indefinite public SDK/bin
  aliases, including old `/core` and `/cli` paths.
- Accept canonical help for both bins, with one compatibility note and unchanged
  non-help output; keep the existing skill slug and script extensions.
- Confirm private workspace consumers migrate atomically without a second
  compatibility workspace, and that no standalone package publication is added.
- Obtain all active owners' freezes and assign the disjoint groups above.
- Separately authorize source relocation, bounded TDD, lock/build/install/skill
  sync/integration work, and any later release; none has occurred in this phase.

## Isolated implementation — August 30, 2026

An isolated implementation starts from published B `860467821d390fab7da8095de9f7fec8b43055de`
(`poe-code@12.0.5`), not the mutable local class/V8 tree. The historical inventory
and proposed ownership above remain as planning provenance; active package paths
now use `packages/safe-js`. Canonical and legacy public routes share exact targets;
there is no private legacy workspace or duplicate runtime. The skill template keeps
its historical filename and `poe-code-safejs` slug while its command examples use
`poe-safe-js`. Snapshot markers, conformance data, historical evidence, and protocols
are preserved. No commits, pushes, or live-directory moves are authorized.

The final patch must be reconciled against the coordinator-provided immutable C
freeze, preserving any approved conditional export trees and browser type leaves.
B-based checks are provisional and do not establish a C/browser release. Unfinished
class/V8 owner patches must map `packages/safejs/` to `packages/safe-js/` separately;
they are not part of this released-baseline rename. External users of the private
`@poe-code/safejs` workspace name must migrate atomically.

## Immutable C reconciliation — August 30, 2026

The C archive includes remote Map/Set callback fixes and its Node/browser Safe FS
configuration. Relocation maps all 395 SafeJS source entries, not just the earlier
392-entry B inventory. No engine or foundation source is substituted from B.
Both public spellings retain C's exact Node-only SafeJS conditions: `browser: null`
and the empty `node-unavailable.d.ts` browser declaration leaf. Safe FS retains
its root/core browser entries, Node-only `/node` route, and private platform type
conditions. Runtime target paths move under `packages/safe-js/dist`; capability,
graph, declaration routing, and validation implementations otherwise remain C's.

The package policy validates all six canonical/legacy SafeJS export condition
trees. A new canonical-alias negative cohort runs before that implementation
change, alongside CLI and root metadata regressions. The frozen compiler owner
increment overlaps `bundle-policy.ts` only in a separate concern and must be
merged against its exact before-image, not overwritten with B or this candidate.

Public host-policy registration remains a separate open contract question. Six
runtime controls show the same registration/declaration split on published B and
its rename; this rename does not change that engine behavior or waive it as safe.
Final source/install/type/graph checks and the C publication/release ordering are
still gates, not claims made by this in-progress source reconciliation.

### Pre-successor C evidence

The isolated C rename passes 1,274 selected tests across 41 files, including the
new remote Map/Set callback cohorts, plus the 163-test focused rename cohort.
The root build completes all 68 workspace tasks. Actual offline npm installation
preserves all three old/new namespace identities and both executable targets on
Node 18.18.2, 18.20.8, 20.19.2, 20.20.0, 22.22.2, and 24.14.0. Ordered-effect
snapshot replay crosses both public spellings and the published B artifact
without changing the jobs-v7 marker.

Strict public declaration checks pass NodeNext and Bundler in 16 Node-only/DOM
configurations across four Node type generations. Browser-condition checks use
the actual installed declarations with no Node ambient types or aliases: public
Safe FS root/core compile; all six SafeJS routes and Safe FS `/node` reject their
Node-only named exports. A fresh isolated Chromium session executes the installed
Safe FS root/core browser artifacts, checking constructor/error identity, shared
memory state, readonly refusal, callback-authority refusal and cancellation.
This is a bounded Safe FS browser proof, not a browser SafeJS implementation or
full browser conformance claim.

At this earlier checkpoint the compiler-lazyload successor was not yet included.
The predecessor archive checksum matched authorization but the manifest file's
digest differed from its receipt. Both observations are retained in the evidence;
the verified successor now supersedes that input for the final rename patch.

### Published C successor reconciliation

The exact owner regression first fails on the renamed eager-compiler source
(one failure, six passes), then passes with the two-file successor. All 214
package-lint tests and the selected 1,275-test/41-file rename regression pass.
The 68-task source build succeeds again. The compiler test file remains byte-exact
to published C, and the final rename patch changes only naming/alias concerns in
the shared policy implementation; it does not re-author the compiler fix.
The registration-only host-policy assessment remains separate and unresolved.

## Release-operator reconciliation — August 30, 2026

The release candidate starts from post-C docs main
`49eea61131a83e2713c5b7ca3b198631bef7be4c`, preserving all verified C paragraphs.
It materializes the frozen 395 relocations and 68 content changes plus this
plan, including the accepted lazy compiler fix. There is no live-source overlay.
The source now implements canonical names with exact legacy public aliases;
the previously published `12.0.7` did not publish those canonical SDK names.
Standing release authorization requires fresh full gates, ordinary hooks and
published-artifact verification; no rename publication is claimed here.

The supplemental published-C FS-only evidence is 102 checks across page/worker
on Chromium 149.0.7827.55, Firefox 150.0.2 and Playwright WebKit 26.4, plus
11 negative browser graphs and 20 strict browser type profiles. It is retained
as C evidence, not counted as a renamed-artifact run or browser SDK coverage.
See `/tmp/published-c-crossbrowser.jzgMlR/REPORT.md` and `final-audit.json`.
Unreleased guest-codec/confinement probes remain separate.

Registration-only public host-policy behavior is a genuine separate contract
issue: the observed live journal is classified for re-issue from its first
issue, rather than losing a read-side-effect classification only on recapture.
Erdos owns that follow-up. No unfinished policy fix, waiver or runtime behavior
change is included in the canonical rename. Full browser SDK and safe-bash
migration remain pending.
