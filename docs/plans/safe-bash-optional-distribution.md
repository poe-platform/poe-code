# Installable opt-in scripting distribution

## September 11 shipping authorization

The user authorized committing and releasing the current WIP. This supersedes
the historical commit and README permission blockers below. The required
optional-package README now documents usage, configuration, and environment.
Full local tests, lint, and build are running; their completion is not yet
claimed. Integration with newer remote main remains necessary.

The public optional package still returns HTTP 404 from the npm registry.
GitHub-only bootstrap and trusted publishing remain publication prerequisites;
no local publication or credential fallback is authorized or attempted.
The prior dated checkpoints remain historical evidence, not current acceptance.

## Status and authority

September 6, 2026: design for root adjudication, not an implemented or published
package. The accepted requirement remains the original
`safe-bash-opt-in-scripting-tools.md` request: deliver the requested tools and
shell extensions as explicit opt-ins, outside the default package, registries,
root barrel and browser runtime. This is a remaining completion obligation;
it does not block separately authorized incremental releases.

Root authorized this dedicated plan and the OP3 packaging-script repair only.
No optional-package manifest, core facade, publication workflow or README change
is authorized yet. The mandatory new-package README awaits user permission.
Kant's active scripting implementation and master plan remain separately owned.

## Current evidence

- `src/optional.ts` exports the seven tool families, device factory and five
  extension factories, plus core `Shell`/`agentCommands` and configuration types.
  `tsconfig.optional.json` compiles that entry into the same workspace dist tree.
  `tests/plugins/optional-runtime.test.ts` imports it using a checkout-relative
  file URL while importing the host through `poe-code/safe-bash`. This proves
  coherent local integration when enabled, not an installed optional API.
- Both root and virtual-bash manifests exclude `dist/optional.*` and the optional
  implementation directories. Neither export map has an optional entrypoint.
  The private workspace is not itself a publishable optional package.
- `scripts/package-safe.mjs` currently generates three scoped packages. Its Bash
  exports derive from the workspace manifest, so it does not provide the missing
  optional API. The release workflow's installed Node/Bun/TypeScript/browser
  consumers exercise existing scoped exports, not optional factories.
- OP3 reproduced a separate flaw: walking all dist files copied optional
  leftovers despite the manifest exclusions. The bounded repair uses the actual
  literal negative declarations, preserves path-prefix siblings and every
  nonexcluded member, and refuses core/export edges into excluded files. It
  does not implement a general npm packlist interpreter or add a new artifact.

The historical pack and current-manifest audit is
`/tmp/741-opt-in-packaging-audit-nVUvks/receipt.json`, SHA256
`5cdd7b665428ba2bae5c70b58874530d8ca1a887d4810925197c6c015f963baf`.
Its historical tarballs prove exclusion, not optional installation. Its prior
0a258 committed-archive consumer receipt is not qualification of the later 741
candidate or of optional publication.

## Proposed package and imports

Propose a separately installed `@poe-platform/safe-bash-optional` artifact; the
name and release policy require adjudication and registry setup. It contains
only selected optional implementations and their own supporting files. It is
not a new entrypoint shipping optional code inside the default core package.

The intended consumer imports are:

```ts
import { Shell, agentCommands } from "@poe-platform/safe-bash";
import { createMemoryFileSystem } from "@poe-platform/safe-fs";
import { yesCommands, arraysExtension, readExtension }
  from "@poe-platform/safe-bash-optional";

const shell = new Shell({
  fs: createMemoryFileSystem(),
  extensions: [arraysExtension(), readExtension({ nonTerminalInput: true })],
}).use(agentCommands()).use(yesCommands());
```

These are proposed specifiers, not imports available today. The consumer owns
execution and disposal. If the optional entry retains `Shell`/`agentCommands`
convenience exports, they must be direct re-exports from the installed core peer.
No second host, automatic registration, default devices or browser expansion.

## Required shared-runtime boundary

A read-only AST scan of the current optional entry reaches 39 optional sources
and records 93 boundary edges, including type-only imports. Its input hashes and
complete edge list are `/tmp/op3-package-author-saQyms/optional-imports.json`,
SHA256 `3eafddf88c1ded083f2e4ba04658777c051bb94c0ba4d67f2bbd8315eac6d4b6`.
This is an import inventory, not a freeze or approval of concurrent jobs work.

| Existing imports | Required installed destination |
| --- | --- |
| `contracts/index`, `command`, `value`, `yield`, `io`, `output`, `errors`, `plugin`, `filesystem-output`, `filesystem-descriptor` | Existing core `./contracts` and `./contracts/*` exports; never copied into the optional artifact |
| `commands/internal`: `codeOf`, `pathOf`, `output` | Proposed narrow core-host support export |
| `commands/copy-identity`: `compareCopyIdentity`, `compareObservedEntries` | Same core-host support export |
| `shell/extensions` types and `shell/input` types `RawRecord`/`ReadLine` | Type-only exports from that support entry; no shell implementation copy |
| `poe-code/safe-fs` | Installed canonical `@poe-platform/safe-fs` peer |
| `node:crypto`, `node:os`, dynamic `yaml` | Explicit Node profile and the existing optional YAML peer contract |

Propose one `@poe-platform/safe-bash/optional-host` support subpath for the five
runtime helpers and required shell types not already exported. It re-exports
existing core definitions only, is not added to a default barrel, and imports
no optional implementation. Existing contract subpaths remain canonical rather
than inventing a new implementation of their interfaces.

Sharing `commandRuntimeIdentity` alone is insufficient. The installed peer must
also own the `CommandArguments` WeakSet, byte-value WeakMap, file-output-budget
WeakMap, yield-checkpoint WeakMap, `outputFailure` symbol, output/descriptor
helpers and canonical filesystem error classes. Duplicating these can reject
binary arguments, lose value provenance or bypass budget/cleanup accounting
even when TypeScript shapes agree. Do not use global symbols, casts, copied
facades or patched identity tags to disguise multiple module instances.

Use exact matching release-version core and filesystem peers initially. The
installed consumer must demonstrate a single canonical dependency graph;
package names or matching versions alone are not proof. Wider peer ranges need
separate compatibility evidence. Preserve `yaml@2.9.0` as the current optional
peer for the yq profile, including its explicit missing-peer failure. Do not
silently add YAML to the default/core runtime or claim broader yq parity.

## Minimal implementation sequence

1. **Core support contract:** add the narrow support entry and corresponding
   workspace/root/scoped export wiring after authorization. Keep implementation
   in its current core modules; export only the measured missing symbols/types.
   Confirm default registries, browser graph and existing consumers unchanged.
2. **Optional artifact build:** add a separately owned package/entry and a
   maintained build route with the core/type prerequisites. Start from the
   optional entry's reachable graph, not an indiscriminate dist copy. Rewrite
   core boundary specifiers to public peers in both JavaScript and declarations;
   preserve optional-local imports and assets. Fail on unmapped core edges,
   copied identity-bearing modules or declarations escaping the package. An
   internal staging compile may produce core outputs, but they cannot enter
   the optional artifact. No source aliases in installed-consumer acceptance.
3. **Artifact generation:** extend the maintained package generator explicitly
   for the separate artifact. Preserve OP3's default exclusions even after an
   optional build. Add a manifest with coherent core/filesystem peers, public
   import/types routes, engine constraints and the approved README/config docs.
4. **Release integration:** only after package/README permission, update the
   maintained scoped-release build/pack/install/publish route, path triggers,
   shared-version calculation and first-publication/trusted-publisher setup.
   Publish prerequisites before the optional package and verify every published
   version. This audit performs no registry lookup or publication.

Proposed disjoint ownership: one worker for core support exports/types; one for
optional artifact/build/rewrite logic; root for manifests, lockfile, README
permission, release workflow and installed-consumer enrollment. The OP3 script
repair must freeze before another worker edits the same generator. Separate
reviewers must approve each increment; this design does not self-approve it.

The proposed new core file is `packages/safe-bash/src/optional-host.ts`; its
export declarations belong in the root and safe-bash manifests. The separate
workspace would be `packages/safe-bash-optional`, with its own entry, manifest
and maintained build declaration. Artifact generation belongs to
`scripts/package-safe.mjs`; installed consumers belong under `scripts/fixtures`
and enrollment/publication in `.github/workflows/release-safe.yml`. These are
proposed future write sets, not permissions to edit those files now.

## Required installed-consumer acceptance

- Pack and install the actual generated core, filesystem and optional tarballs
  in an approved isolated consumer, without checkout resolution, source aliases,
  workspace links or post-install source compilation. Run plain Node and the
  maintained TypeScript consumer; include Bun if retained as a release gate.
- Assert optional definitions carry the installed core identity and work in
  both constructor-supplied and later-registered command registries. Preserve
  rejection of a deliberately separate core instance, including empty/populated
  registry paths; do not weaken the existing runtime-affinity tests.
- Exercise raw FF/UTF-8 arguments and byte values, short-consumer yes cleanup,
  named dd/install output budgets, cancellation/falsey failures, descriptor
  close drain, explicit device mounting, arrays/read/mapfile/trap/jobs in actual
  Shell composition, and selected qualified yq behavior with and without its
  optional peer. Migrate existing compiled controls to these real package imports.
- Independently inspect core/root/browser artifacts after default and optional
  builds: no optional implementation or factory registration. Inspect the
  optional tarball for the converse error: no copied core runtime/brands or
  filesystem implementation. Keep legitimate worker/data/export members.
- Record artifact hashes, peer resolution, all outputs and cleanup outcomes.
  Verify remote-main inclusion and the resulting published optional version
  separately from local build/install evidence. Passing this distribution slice
  does not complete still-open shell/tool semantics or imply whole Bash parity.

Unit packaging tests remain memfs-only. Installed archive tests and publication
are future separately admitted integration work; no new native oracle is needed
to reproduce the packaging defect.

## September 6 implementation checkpoint

The separately authorized core host now directly re-exports five canonical
runtime helpers and twenty types through `./optional-host`; its four-file
source/manifest freeze has independent approval
(`/tmp/optional-host-independent-w9MHtU/approval.json`, SHA256
`bda77b85b0cd0375f8e153395c3cf2394ebdbf64b66f295dcef3522c5b21cf4a`).
The source test is now literally enrolled after the separate trapped-wait
commit closed. This does not establish installed or published identity.

The new private checkout workspace is `@poe-code/safe-bash-optional`, distinct
from the proposed generated public name. Its build dependency declarations
use only existing private `virtual-bash` and `@poe-code/safe-fs` workspaces;
there are no unpublished public peers to resolve during installation. Its
declared unit task owns the optional workspace tests, while the maintained
build planner orders the filesystem and core prerequisites first. The lifecycle
passes the actual maintained `buildPackage` callback to the separate graph
stage, rejects CLI option overrides and preserves failed-stage outcomes.

The initial ten integration controls failed before these files existed, then
the nine lifecycle controls and task-discovery control passed. A further
memfs integration control exposes a remaining interface mismatch: the frozen
graph stage requires the publication manifest's public name and peers before
calling the compiler, so it rejects this install-safe private manifest. That
red is retained in `/tmp/optional-workspace-integration-cC98sL`; the graph-stage
owner must resolve the private-build versus publication-manifest boundary.
Mocked lifecycle success is not a real optional compilation result.

The lockfile was updated by npm in package-lock-only, ignore-scripts, offline
mode; exactly the workspace record and its local link were added, with no
existing package records changed. Actual compilation, generated artifacts,
installed consumers, README permission and release workflow integration remain
pending. The observed anonymous public-name 404 does not prove namespace
availability, publishing permission or trusted-publisher bootstrap. Publication
must use the separately approved GitHub-only route, without a token fallback
or an assumption that OIDC can bootstrap a new npm package.

## September 6 release-workflow integration

The authorized workflow delta adds the optional workspace path trigger and
uses the maintained workspace build plus explicit generator
`--include-optional`. Its installed optional fixture interface is
`node safe-packages-optional.mjs <absolute-second-installed-consumer>` (also
run with Bun), with adjacent no-YAML and strict TypeScript fixtures. These
fixtures and the generator remain owned by their separate authors. No build,
pack, installation or registry operation was run to validate this workflow
edit; syntax validation is not installed-artifact acceptance.

The no-YAML consumer installs only the three matching filesystem/core/optional
tarballs before YAML or the legacy root package can enter that graph. A
second, independently installed graph supplies the identity-rejection control.
The YAML profile pins `2.9.0`. Existing scoped core, browser, legacy coexistence
and filesystem-only consumers are retained. The generator's unflagged
three-artifact contract remains unchanged.

Version selection requires valid public metadata for all four packages and
distinguishes actual HTTP 404 from other HTTP, network and metadata failures;
there is no zero-version fallback. An absent optional name blocks this route
pending external setup. The optional README is an explicit prerequisite, not
permission to write it. Existing three publication commands remain ordered;
their exact versions must be registry-visible before the optional fourth
publish, whose exact version is also required before the success summary.
No optional-publish skip, token fallback or automatic trust/bootstrap mutation
is introduced. The separate original-worktree workflow is not yet a published
optional distribution and does not alter the frozen delivery clone.

## September 6 compiled optional candidate checkpoint

The canonical optional-host interface is locally committed as
`2e25b9d121c614c242773e2fd52427c9e298b1eb`; its five paths are excluded from
the remaining optional-distribution commit inventory. The private-manifest
admission red above is resolved by the separately reviewed builder/compiler
interface: the unchanged workspace cohort passes 71/71, enrollment 98/98,
and discovery 27/27. These controls do not substitute for installed consumers.

The maintained selected build
`npm run build:workspaces -- --workspace=@poe-code/safe-bash-optional`
now passes through the filesystem, core, and optional lifecycle stages.
Receipt `/tmp/optional-selected-build-Qs4xsL/final.json` has SHA256
`bf2ff172d25783977733f1c758774871913b285d56e25146f545d1d5f48a452d`:
959 inputs remained stable; the optional output contains 39 JavaScript and
20 declaration files with 180 resolved module edges, no core vendoring and
no emitted maps. This is actual compilation, not pack/install acceptance or
proof that default scoped artifacts exclude optional compiler leftovers.

The installed fixtures have static review only. The workflow now runs their
exact strict TypeScript profile both before and after adding YAML 2.9.0;
the no-YAML runtime profile still precedes legacy-root installation.
Workflow-delta approval `/tmp/optional-workflow-delta-independent-mdqSqb/approval.json`
has SHA256 `d2bc84451576c0f169a7b8ae2902336144040f7f86d35e5fa2fdb50dde4fe979`;
maintained workflow lint passes, but no installed execution is implied.

The remaining source inventory is 17 paths: the workflow, publishing guide,
this plan, lockfile, two core compiler files, five optional workspace files,
two generator files, workspace test ownership, and three installed fixtures.
Exact current bindings are captured under `/tmp/optional-consolidated-NENFKI`.
Generated outputs, committed host paths and unrelated working-tree changes
are excluded. The generator has a newer OG1 path-admission repair frozen at
`/tmp/optional-generator-OG1-6xa0ji/freeze.json`; its independent rereview is
pending rather than inherited from the earlier generator candidate.

README permission/content and generator approval still block this source
commit. Actual default/optional pack inspection, fresh matching-tarball
Node/Bun consumers, before/after-YAML declaration checks and foreign-graph
rejection remain pending. Public-name ownership, bootstrap and trusted
publisher configuration remain external prerequisites; anonymous 404 is not
permission or availability evidence. No commit, push, registry mutation or
publication is authorized by this checkpoint, and broader Bash/tool parity
remains outside these distribution results.
