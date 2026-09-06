# Installable opt-in scripting distribution

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
