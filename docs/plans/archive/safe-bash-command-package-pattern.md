---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1
readiness: draft
tasks:
  - id: inspect-build-contract
    title: Inspect command ownership and packed exports
    prompt: >
      All newly added commands live in their own private
      safe-bash-command-<name> workspace. Establish the convention without
      moving existing commands or expanding default registration silently. There
      is one plan per command; shared parsing belongs in narrowly scoped private
      engine packages. Zero dependencies means zero external runtime
      dependencies in the shipped artifact; private first-party source can be
      bundled. Development-only tools and upstream test oracles do not become
      runtime dependencies. Inspect the current guarded safe-bash builder,
      opt-in exports, integration boundaries, package-lint, declaration
      rewriting and packed-consumer routes before choosing integration details.

      Inspect packages/safe-bash/package.json, scripts/build.mjs,
      integration-boundaries.json, scripts/integration-inputs.mjs, root
      workspace/build declarations and package-lint bundling/declaration policy.
      Record authoritative source paths in this plan. Specify package name
      safe-bash-command-<name>, folder packages/safe-bash-command-<name>,
      private: true, proposed safe-bash subpath ./commands/<name>, typed factory
      APIs and opt-in registration. Resolve any cycle caused by command packages
      importing safe-bash contracts through a narrowly scoped contract boundary;
      do not introduce a safe-bash to command to safe-bash build cycle.


      Verified current sources: scripts/build-workspaces.mjs derives edges from
      dependencies, devDependencies and optionalDependencies and rejects
      workspace peers; importing safe-bash from a command workspace while
      safe-bash depends on that command creates a cycle even if the return edge
      is development-only. scripts/package-safe.mjs rejects leaked private
      runtime specifiers and rewrites private declaration imports.
      packages/safe-bash/scripts/build.mjs admits explicit source/tool roots and
      held-path boundaries; ordinary tsc or globbing siblings is not an
      equivalent build path. Do not bypass these maintained checks. Design a
      private leaf contract owner for canonical command/value/error runtime
      implementation; preserve argument/value brands, constructor identity and
      existing public contract exports. The dependency DAG is first-party
      engines/contracts → command packages → safe-bash, with no
      command-to-safe-bash return edge. Prove that DAG through maintained
      declarations and packed consumers before command integration; record exact
      leaf naming during implementation.


      Cross-command implementation assessment: Implementation assessment from
      pinned source: fmt/fold/diff3 have bounded text algorithms but
      GNU-specific bytes/locale/cost/merge rules; CSV tools need shared
      Decimal/date/inference semantics; htmlq needs HTML5 tree builder plus
      legacy selector/serializer contract, not browser API substitution. PDF
      metadata/text requires xref/filter/crypto/font/CMap and ordering engines;
      qpdf additionally needs graph-aware writer and linearization. unrtf
      combines group stack/control words/output profiles and legacy quirks.
      ExifTool needs format-specific read/write registries with independent
      writability (DOCX native reader has no writer).
      soffice/wkhtmltopdf/tesseract require substantial layout/render/model
      inference engines, fonts/image codecs and explicitly versioned assets;
      zero-dependency JS is a research-and-engineering program, not a small CLI
      wrapper. Keep all 16 command plans, shared PDF/parser/package gates, and
      intended profiles intact. User requested PDF parser first even though
      smaller text utilities are simpler; sequence metadata gate before
      text/layout before lossless transformations. No external parser
      recommendation adopted. Native controls are development-only research and
      never shipping dependencies.



      Canonical argument source detail: getCommandArguments requires both the
      module-owned WeakSet brand and exact carrier.args===context.args identity.
      An adapter that recreates args with spread/map can fail admission despite
      equal strings; preserve the paired carrier/context or rebuild through the
      canonical factory with admitted allocation accounting. ByteShellValue owns
      copied bytes in a WeakMap and caches lossy UTF8 presentation using
      ignoreBOM=true; distinct invalid bytes can project to equal args strings.
      Command-specific byte semantics must consume carrier.bytes/values, not
      re-encode args; any decoded text policy is explicit. bytes() returns an
      owned copy with the supplied allocation contract, so account copies rather
      than treating it as a zero-copy borrow. Brand extraction must preserve
      reservation rollback/falsey errors and invocation lifetime, not only
      TypeScript shapes. The current string byte-length helper uses
      Buffer.byteLength; leaf extraction must retain the qualified runtime
      closure for each advertised consumer and verify its browser/workerd
      prerequisites, never assume that a private package manifest makes a
      Node-only global portable.
    status:
      implement: done
  - id: package-convention
    title: Establish maintained private command workspace conventions
    prompt: >
      All newly added commands live in their own private
      safe-bash-command-<name> workspace. Establish the convention without
      moving existing commands or expanding default registration silently. There
      is one plan per command; shared parsing belongs in narrowly scoped private
      engine packages. Zero dependencies means zero external runtime
      dependencies in the shipped artifact; private first-party source can be
      bundled. Development-only tools and upstream test oracles do not become
      runtime dependencies. Inspect the current guarded safe-bash builder,
      opt-in exports, integration boundaries, package-lint, declaration
      rewriting and packed-consumer routes before choosing integration details.

      Define minimal package manifest, source/test tsconfigs, build/lint/unit
      declarations, LICENSE and user-facing README expectations using maintained
      workspace declarations. Commands implement actual CommandDefinition
      handlers; do not add proxy-only functions. Shared pure engines own logic;
      safe-bash owns composition. Enforce private package status through
      existing package-lint policy with a failing test first if enforcement
      requires code. Do not create empty command scaffolds or mass-migrate
      existing commands.


      Use a small private contracts workspace as the shared owner of existing
      command, arguments/value, stream, output and plugin contracts, with
      dependencies only on admitted first-party path/filesystem primitives.
      Extract the smallest cohesive closure established by imports; retain
      compatibility re-exports from all existing safe-bash contract paths. Do
      not rename public classes or weaken runtime identity/byte brands. Both
      command workspaces and safe-bash build against this leaf workspace; engine
      packages never depend on safe-bash. Declare maintained workspace build and
      unit membership explicitly through existing declarations. Do not extract
      unrelated shell parsing/state logic.


      Cross-command implementation assessment: Implementation assessment from
      pinned source: fmt/fold/diff3 have bounded text algorithms but
      GNU-specific bytes/locale/cost/merge rules; CSV tools need shared
      Decimal/date/inference semantics; htmlq needs HTML5 tree builder plus
      legacy selector/serializer contract, not browser API substitution. PDF
      metadata/text requires xref/filter/crypto/font/CMap and ordering engines;
      qpdf additionally needs graph-aware writer and linearization. unrtf
      combines group stack/control words/output profiles and legacy quirks.
      ExifTool needs format-specific read/write registries with independent
      writability (DOCX native reader has no writer).
      soffice/wkhtmltopdf/tesseract require substantial layout/render/model
      inference engines, fonts/image codecs and explicitly versioned assets;
      zero-dependency JS is a research-and-engineering program, not a small CLI
      wrapper. Keep all 16 command plans, shared PDF/parser/package gates, and
      intended profiles intact. User requested PDF parser first even though
      smaller text utilities are simpler; sequence metadata gate before
      text/layout before lossless transformations. No external parser
      recommendation adopted. Native controls are development-only research and
      never shipping dependencies.



      Canonical argument source detail: getCommandArguments requires both the
      module-owned WeakSet brand and exact carrier.args===context.args identity.
      An adapter that recreates args with spread/map can fail admission despite
      equal strings; preserve the paired carrier/context or rebuild through the
      canonical factory with admitted allocation accounting. ByteShellValue owns
      copied bytes in a WeakMap and caches lossy UTF8 presentation using
      ignoreBOM=true; distinct invalid bytes can project to equal args strings.
      Command-specific byte semantics must consume carrier.bytes/values, not
      re-encode args; any decoded text policy is explicit. bytes() returns an
      owned copy with the supplied allocation contract, so account copies rather
      than treating it as a zero-copy borrow. Brand extraction must preserve
      reservation rollback/falsey errors and invocation lifetime, not only
      TypeScript shapes. The current string byte-length helper uses
      Buffer.byteLength; leaf extraction must retain the qualified runtime
      closure for each advertised consumer and verify its browser/workerd
      prerequisites, never assume that a private package manifest makes a
      Node-only global portable.
    status:
      implement: done
      refactor: done
      test: done
  - id: bundle-export-contract
    title: Bundle private command implementations behind safe-bash exports
    prompt: >
      All newly added commands live in their own private
      safe-bash-command-<name> workspace. Establish the convention without
      moving existing commands or expanding default registration silently. There
      is one plan per command; shared parsing belongs in narrowly scoped private
      engine packages. Zero dependencies means zero external runtime
      dependencies in the shipped artifact; private first-party source can be
      bundled. Development-only tools and upstream test oracles do not become
      runtime dependencies. Inspect the current guarded safe-bash builder,
      opt-in exports, integration boundaries, package-lint, declaration
      rewriting and packed-consumer routes before choosing integration details.

      Design and implement the minimal reusable build/export integration against
      one real command candidate from its plan. Add a failing packed-consumer
      test proving safe-bash command subpath import, declarations and runtime
      behavior work with no command workspace present. Bundle private source and
      rewrite shipped declarations; no bare unpublished imports in JS or d.ts.
      Keep export conditions and Node/browser/workerd runtime support honest.
      Parse and deep merge modified manifests, never regex-edit configs.


      Runtime identity is a hard gate: contracts/command.ts uses a module-local
      WeakSet for CommandArguments and contracts/value.ts uses a module-local
      WeakMap for ByteShellValue. Bundling a second copy into a command breaks
      getCommandArguments even when structural types match. FsError/instanceof
      and commandRuntimeIdentity have similar concerns. In one platform profile,
      root exports, contracts subpaths and command subpaths must resolve the
      same owning modules through one shared graph/chunks or one canonical
      relative artifact, not independent copies. Exercise actual Shell-created
      byte argv through an isolated packed command subpath. Assert equality of
      error constructors and runtime identities between imports.


      Cross-command implementation assessment: Implementation assessment from
      pinned source: fmt/fold/diff3 have bounded text algorithms but
      GNU-specific bytes/locale/cost/merge rules; CSV tools need shared
      Decimal/date/inference semantics; htmlq needs HTML5 tree builder plus
      legacy selector/serializer contract, not browser API substitution. PDF
      metadata/text requires xref/filter/crypto/font/CMap and ordering engines;
      qpdf additionally needs graph-aware writer and linearization. unrtf
      combines group stack/control words/output profiles and legacy quirks.
      ExifTool needs format-specific read/write registries with independent
      writability (DOCX native reader has no writer).
      soffice/wkhtmltopdf/tesseract require substantial layout/render/model
      inference engines, fonts/image codecs and explicitly versioned assets;
      zero-dependency JS is a research-and-engineering program, not a small CLI
      wrapper. Keep all 16 command plans, shared PDF/parser/package gates, and
      intended profiles intact. User requested PDF parser first even though
      smaller text utilities are simpler; sequence metadata gate before
      text/layout before lossless transformations. No external parser
      recommendation adopted. Native controls are development-only research and
      never shipping dependencies.



      Canonical argument source detail: getCommandArguments requires both the
      module-owned WeakSet brand and exact carrier.args===context.args identity.
      An adapter that recreates args with spread/map can fail admission despite
      equal strings; preserve the paired carrier/context or rebuild through the
      canonical factory with admitted allocation accounting. ByteShellValue owns
      copied bytes in a WeakMap and caches lossy UTF8 presentation using
      ignoreBOM=true; distinct invalid bytes can project to equal args strings.
      Command-specific byte semantics must consume carrier.bytes/values, not
      re-encode args; any decoded text policy is explicit. bytes() returns an
      owned copy with the supplied allocation contract, so account copies rather
      than treating it as a zero-copy borrow. Brand extraction must preserve
      reservation rollback/falsey errors and invocation lifetime, not only
      TypeScript shapes. The current string byte-length helper uses
      Buffer.byteLength; leaf extraction must retain the qualified runtime
      closure for each advertised consumer and verify its browser/workerd
      prerequisites, never assume that a private package manifest makes a
      Node-only global portable.
    status:
      implement: done
      refactor: done
      test: done
  - id: registration-contract
    title: Preserve opt-in command composition and collisions
    prompt: >
      All newly added commands live in their own private
      safe-bash-command-<name> workspace. Establish the convention without
      moving existing commands or expanding default registration silently. There
      is one plan per command; shared parsing belongs in narrowly scoped private
      engine packages. Zero dependencies means zero external runtime
      dependencies in the shipped artifact; private first-party source can be
      bundled. Development-only tools and upstream test oracles do not become
      runtime dependencies. Inspect the current guarded safe-bash builder,
      opt-in exports, integration boundaries, package-lint, declaration
      rewriting and packed-consumer routes before choosing integration details.

      Specify per-command options, replace semantics and collision preflight
      using existing CommandDefinition and VirtualShellPlugin contracts. New
      commands are opt-in unless explicitly authorized for defaults. Test
      command dispatch through Shell, middleware, pipes and VFS scripts. If
      defaults change later, update independent maintained inventories
      explicitly; do not derive expected names from registry under test.


      Cross-command implementation assessment: Implementation assessment from
      pinned source: fmt/fold/diff3 have bounded text algorithms but
      GNU-specific bytes/locale/cost/merge rules; CSV tools need shared
      Decimal/date/inference semantics; htmlq needs HTML5 tree builder plus
      legacy selector/serializer contract, not browser API substitution. PDF
      metadata/text requires xref/filter/crypto/font/CMap and ordering engines;
      qpdf additionally needs graph-aware writer and linearization. unrtf
      combines group stack/control words/output profiles and legacy quirks.
      ExifTool needs format-specific read/write registries with independent
      writability (DOCX native reader has no writer).
      soffice/wkhtmltopdf/tesseract require substantial layout/render/model
      inference engines, fonts/image codecs and explicitly versioned assets;
      zero-dependency JS is a research-and-engineering program, not a small CLI
      wrapper. Keep all 16 command plans, shared PDF/parser/package gates, and
      intended profiles intact. User requested PDF parser first even though
      smaller text utilities are simpler; sequence metadata gate before
      text/layout before lossless transformations. No external parser
      recommendation adopted. Native controls are development-only research and
      never shipping dependencies.



      Canonical argument source detail: getCommandArguments requires both the
      module-owned WeakSet brand and exact carrier.args===context.args identity.
      An adapter that recreates args with spread/map can fail admission despite
      equal strings; preserve the paired carrier/context or rebuild through the
      canonical factory with admitted allocation accounting. ByteShellValue owns
      copied bytes in a WeakMap and caches lossy UTF8 presentation using
      ignoreBOM=true; distinct invalid bytes can project to equal args strings.
      Command-specific byte semantics must consume carrier.bytes/values, not
      re-encode args; any decoded text policy is explicit. bytes() returns an
      owned copy with the supplied allocation contract, so account copies rather
      than treating it as a zero-copy borrow. Brand extraction must preserve
      reservation rollback/falsey errors and invocation lifetime, not only
      TypeScript shapes. The current string byte-length helper uses
      Buffer.byteLength; leaf extraction must retain the qualified runtime
      closure for each advertised consumer and verify its browser/workerd
      prerequisites, never assume that a private package manifest makes a
      Node-only global portable.


      Local registration contract and QA evidence:
      docs/plans/safe-bash-registration-contract-qa.md. Both current private
      command plugins expose explicit replace policy; default inventories remain
      unchanged. Focused unit, lint/typechecks, discovery and isolated packed
      Node runtime/declarations passed. Other platform and broader publication
      gates remain separate.
    status:
      implement: done
      refactor: done
      test: done
  - id: publication-boundary
    title: Verify private publication boundary and installed artifacts
    prompt: >
      All newly added commands live in their own private
      safe-bash-command-<name> workspace. Establish the convention without
      moving existing commands or expanding default registration silently. There
      is one plan per command; shared parsing belongs in narrowly scoped private
      engine packages. Zero dependencies means zero external runtime
      dependencies in the shipped artifact; private first-party source can be
      bundled. Development-only tools and upstream test oracles do not become
      runtime dependencies. Inspect the current guarded safe-bash builder,
      opt-in exports, integration boundaries, package-lint, declaration
      rewriting and packed-consumer routes before choosing integration details.

      Check the latest release-safe workflow and
      scripts/verify-safe-publication.mjs. Ensure private command packages are
      never standalone publication candidates and safe-bash packing includes
      their required bytes, types, licenses and explicit assets. Prefer
      maintained declarations over command-name switch statements. Use npm run
      lint:workflows if workflows change; no workflow unit tests. Verify an
      isolated packed consumer without workspace resolution or ambient
      executables.


      The current release-safe workflow names only safe-fs, safe-js and
      safe-bash. It need not gain a new publication job for commands.
      scripts/package-safe.mjs currently has special op/pandoc bundling recipes;
      introduce a reusable declarative command export recipe rather than another
      command-name switch. Keep private workspace declarations/assets inside
      safe-bash packing, no bare command/engine/contract package requirements.
      Audit ordinary Node exports and browser/workerd graphs independently; a
      Node shared-chunk test does not certify browser constructor identity.
      Preserve current source exclusions, held source/evidence paths and archive
      admission.


      Cross-command implementation assessment: Implementation assessment from
      pinned source: fmt/fold/diff3 have bounded text algorithms but
      GNU-specific bytes/locale/cost/merge rules; CSV tools need shared
      Decimal/date/inference semantics; htmlq needs HTML5 tree builder plus
      legacy selector/serializer contract, not browser API substitution. PDF
      metadata/text requires xref/filter/crypto/font/CMap and ordering engines;
      qpdf additionally needs graph-aware writer and linearization. unrtf
      combines group stack/control words/output profiles and legacy quirks.
      ExifTool needs format-specific read/write registries with independent
      writability (DOCX native reader has no writer).
      soffice/wkhtmltopdf/tesseract require substantial layout/render/model
      inference engines, fonts/image codecs and explicitly versioned assets;
      zero-dependency JS is a research-and-engineering program, not a small CLI
      wrapper. Keep all 16 command plans, shared PDF/parser/package gates, and
      intended profiles intact. User requested PDF parser first even though
      smaller text utilities are simpler; sequence metadata gate before
      text/layout before lossless transformations. No external parser
      recommendation adopted. Native controls are development-only research and
      never shipping dependencies.



      Canonical argument source detail: getCommandArguments requires both the
      module-owned WeakSet brand and exact carrier.args===context.args identity.
      An adapter that recreates args with spread/map can fail admission despite
      equal strings; preserve the paired carrier/context or rebuild through the
      canonical factory with admitted allocation accounting. ByteShellValue owns
      copied bytes in a WeakMap and caches lossy UTF8 presentation using
      ignoreBOM=true; distinct invalid bytes can project to equal args strings.
      Command-specific byte semantics must consume carrier.bytes/values, not
      re-encode args; any decoded text policy is explicit. bytes() returns an
      owned copy with the supplied allocation contract, so account copies rather
      than treating it as a zero-copy borrow. Brand extraction must preserve
      reservation rollback/falsey errors and invocation lifetime, not only
      TypeScript shapes. The current string byte-length helper uses
      Buffer.byteLength; leaf extraction must retain the qualified runtime
      closure for each advertised consumer and verify its browser/workerd
      prerequisites, never assume that a private package manifest makes a
      Node-only global portable.
    status:
      implement: done
      refactor: done
      test: done
  - id: document-convention
    title: Document adoption and final architecture acceptance
    prompt: >
      All newly added commands live in their own private
      safe-bash-command-<name> workspace. Establish the convention without
      moving existing commands or expanding default registration silently. There
      is one plan per command; shared parsing belongs in narrowly scoped private
      engine packages. Zero dependencies means zero external runtime
      dependencies in the shipped artifact; private first-party source can be
      bundled. Development-only tools and upstream test oracles do not become
      runtime dependencies. Inspect the current guarded safe-bash builder,
      opt-in exports, integration boundaries, package-lint, declaration
      rewriting and packed-consumer routes before choosing integration details.

      Update this plan with exact package layout, chosen contract import
      boundary and packed export evidence. Keep safe-bash README compact and
      usage-first, with a verified import example in an existing section; each
      real command package gets its own user-facing README. Gate acceptance on
      uncached maintained build, test and lint routes covering shared changes
      and genuine installed-artifact checks. This plan does not authorize
      standalone publication of private command packages.


      packages/safe-bash/AGENTS.md now records the new package/private/export
      rule. Treat it as a durable requirement; this plan defines the remaining
      build implementation. Verify the dependency graph remains acyclic and the
      private flag holds for every newly created command package. Do not confuse
      an architecture plan with implemented package integration. Keep exact
      package exports examples marked proposed until actual packed consumers
      pass.


      Cross-command implementation assessment: Implementation assessment from
      pinned source: fmt/fold/diff3 have bounded text algorithms but
      GNU-specific bytes/locale/cost/merge rules; CSV tools need shared
      Decimal/date/inference semantics; htmlq needs HTML5 tree builder plus
      legacy selector/serializer contract, not browser API substitution. PDF
      metadata/text requires xref/filter/crypto/font/CMap and ordering engines;
      qpdf additionally needs graph-aware writer and linearization. unrtf
      combines group stack/control words/output profiles and legacy quirks.
      ExifTool needs format-specific read/write registries with independent
      writability (DOCX native reader has no writer).
      soffice/wkhtmltopdf/tesseract require substantial layout/render/model
      inference engines, fonts/image codecs and explicitly versioned assets;
      zero-dependency JS is a research-and-engineering program, not a small CLI
      wrapper. Keep all 16 command plans, shared PDF/parser/package gates, and
      intended profiles intact. User requested PDF parser first even though
      smaller text utilities are simpler; sequence metadata gate before
      text/layout before lossless transformations. No external parser
      recommendation adopted. Native controls are development-only research and
      never shipping dependencies.



      Canonical argument source detail: getCommandArguments requires both the
      module-owned WeakSet brand and exact carrier.args===context.args identity.
      An adapter that recreates args with spread/map can fail admission despite
      equal strings; preserve the paired carrier/context or rebuild through the
      canonical factory with admitted allocation accounting. ByteShellValue owns
      copied bytes in a WeakMap and caches lossy UTF8 presentation using
      ignoreBOM=true; distinct invalid bytes can project to equal args strings.
      Command-specific byte semantics must consume carrier.bytes/values, not
      re-encode args; any decoded text policy is explicit. bytes() returns an
      owned copy with the supplied allocation contract, so account copies rather
      than treating it as a zero-copy borrow. Brand extraction must preserve
      reservation rollback/falsey errors and invocation lifetime, not only
      TypeScript shapes. The current string byte-length helper uses
      Buffer.byteLength; leaf extraction must retain the qualified runtime
      closure for each advertised consumer and verify its browser/workerd
      prerequisites, never assume that a private package manifest makes a
      Node-only global portable.
    status:
      implement: done
finalization: completed
name: safe-bash-command-package-pattern
state: archived
---

# Private safe-bash command package and export pattern

All newly added commands live in their own private safe-bash-command-<name> workspace. Establish the convention without moving existing commands or expanding default registration silently. There is one plan per command; shared parsing belongs in narrowly scoped private engine packages. Zero dependencies means zero external runtime dependencies in the shipped artifact; private first-party source can be bundled. Development-only tools and upstream test oracles do not become runtime dependencies. Inspect the current guarded safe-bash builder, opt-in exports, integration boundaries, package-lint, declaration rewriting and packed-consumer routes before choosing integration details.

Execution order: package pattern and PDF parser first; pdfinfo and pdftotext next. qpdf depends on the parser plus a separate lossless writer. CSV tools share a parser and selector contract. htmlq and HTML-to-PDF share HTML primitives where genuinely reusable. unrtf and soffice reuse existing Pandoc formats where verified. No ssconvert plan: existing packages/pandoc/src/formats/xlsx.ts declares XLSX reading; this observation does not claim spreadsheet round-trip parity.

Scope includes the previously deferred qpdf, exiftool, soffice, tesseract and wkhtmltopdf tools. Their plans explicitly describe complete intended profiles and staged work rather than substituting host programs or silently dropping hard features. Tool names describe compatibility targets, not claims of upstream identity. Unsupported native flags must produce explicit errors.

Execution: tasks are ordered; prerequisite plans must pass their stated acceptance gates before dependent integration. Draft plans define work; tasks remain open until executed and verified. Do not mark implementation or compatibility complete from planning, unit counts, or an unexecuted native comparison.

Delivery: use maintained workspace checks and build closures; broad build/export infrastructure changes require npm test, repository lint and npm run build. Commit only task-owned paths in atomic Conventional Commits when assigned. Push only when instructed; report local commits, remote-main verification and successful releases separately. Private command packages remain unpublished. Store temporary outputs under out and purge them after review.

## Research findings from current main

Repository baseline after the requested pull: `9b64178e6`. Later concurrent edits must be preserved and rechecked at execution time.

| Source | Observed constraint | Required consequence |
| --- | --- | --- |
| `scripts/build-workspaces.mjs`, dependencyFields and collect graph | Development dependencies also create local build edges; internal peers are rejected | Commands cannot depend back on safe-bash; extract a cohesive leaf contract owner |
| `packages/safe-bash/src/contracts/command.ts`, argumentCarriers/getCommandArguments | Argument carriers are recognized by a module-local WeakSet | A private command must consume the shell's canonical argument implementation |
| `packages/safe-bash/src/contracts/value.ts`, byteValues/record | Owned byte values are branded by a module-local WeakMap | Sharing TypeScript interfaces without runtime ownership is insufficient |
| `packages/safe-bash/src/contracts/errors.ts` and commandRuntimeIdentity | Constructor/object identity matters at runtime | Test identity across root, contract and command export routes |
| `packages/safe-bash/scripts/build.mjs`, compilerInputs | Guarded compiler reads are restricted to admitted roots | Sibling source must enter through reviewed first-party build declarations, not a raw tsconfig include |
| `packages/safe-bash/integration-boundaries.json` | XAN source and evidence are held inputs | Do not extract, rewrite, import or build XAN to obtain a convenient CSV parser; existing descriptions are not build admission |
| `scripts/package-safe.mjs`, addDependency/rewriteModuleSpecifiers | Bare private/CLI runtime dependencies are rejected; private declarations can be copied/rebased | Bundle JS and rebase d.ts into the safe-bash artifact; an npm workspace symlink is not installed-consumer proof |
| `.github/workflows/release-safe.yml` | Publishes three named safe libraries only | Keep each command package private; publication scope must not expand |

## Concrete package ownership

The intended build DAG is `first-party engines/contracts → safe-bash-command-<name> → safe-bash` in prerequisite order. The implemented leaf is `safe-bash-contracts`, in `packages/safe-bash-contracts`, with `private: true`; the current-checkout inspection below records its ownership and maintained integration. Safe-bash retains its current public contract paths through compatibility re-exports. The leaf is packed inside safe-bash rather than independently installed.

Each command package owns argument interpretation, actual command handler, command-specific pure logic, tests, user README and license notices. A shared engine owns only behavior required by more than one consumer: PDF parsing for three commands and CSV parsing/inference for four are justified. Do not create a generic framework for unspecified future commands. Static export facades are permissible wiring; proxy-only runtime functions are not.

The requested PDF implementation sequence starts with `pdfinfo` after the parser metadata gate. Existing ExifTool PNG and wkhtmltopdf adapter profiles can qualify package integration without qualifying PDF compatibility or renderer fidelity. A temporary fake command does not establish the pattern. Future command factories are proposed to match existing `create<Name>Command(options?)`, `create<Name>Commands(options?)` and `<name>Commands(options?)` conventions only when each serves a real public composition use case. Avoid creating redundant wrappers merely for visual consistency.

## Packed-consumer acceptance cases

1. Install only the packed safe-bash artifact and its explicitly declared public safe-library dependencies into a fresh temporary consumer. Remove access to repo node_modules, private workspaces and TS source aliases.
2. Import `Shell` and a new command factory from root and `./commands/<name>`; register the command and execute stdin, a VFS file and a VFS script with a pipeline.
3. Pass shell-created byte-valued argv containing distinct undecodable bytes. The command must retain byte identity and accept the canonical carrier; a second WeakSet implementation must fail the negative control.
4. Compare exported FsError constructors/runtime identity and exercise a filesystem error crossing the command boundary. Duck typing must not replace the established error contract.
5. Resolve the same command's public d.ts with strict NodeNext from the installed artifact. No type import may name an unpublished workspace or root poe-code package.
6. For each advertised browser/workerd route, bundle and execute the applicable consumer with denied host filesystem/process/network. Asset URLs resolve inside the package; no Node-only font/crypto implementation leaks into that route.
7. Inspect the packed import and asset graph, not only entrypoints. Dynamic imports, import-type nodes, workers, URL assets and declarations must all be admitted and present.
8. Re-run uncached maintained broad build/lint/test routes once integration changes shared infrastructure; do not reuse historical artifact receipts as current qualification.

## Dependency reuse audit

`packages/pdf/package.json` declares `pdf-lib`, `@pdf-lib/fontkit` and `pako`, and its source imports them. `packages/pandoc/package.json` declares `parse5`, `entities`, `saxes`, `jpeg-js` and other dependencies. Reusing these whole workspaces in a newly promised zero-dependency command imports their runtime graph even if command package.json is empty. For each reuse, either extract genuinely dependency-free first-party primitives with independent tests, implement the missing first-party engine, or obtain the user's explicit approval for a dependency exception. Do not rewrite these existing engines merely to satisfy planning.


## Utility assessment and engine boundaries

Implementation assessment from pinned source: fmt/fold/diff3 have bounded text algorithms but GNU-specific bytes/locale/cost/merge rules; CSV tools need shared Decimal/date/inference semantics; htmlq needs HTML5 tree builder plus legacy selector/serializer contract, not browser API substitution. PDF metadata/text requires xref/filter/crypto/font/CMap and ordering engines; qpdf additionally needs graph-aware writer and linearization. unrtf combines group stack/control words/output profiles and legacy quirks. ExifTool needs format-specific read/write registries with independent writability (DOCX native reader has no writer). soffice/wkhtmltopdf/tesseract require substantial layout/render/model inference engines, fonts/image codecs and explicitly versioned assets; zero-dependency JS is a research-and-engineering program, not a small CLI wrapper. Keep all 16 command plans, shared PDF/parser/package gates, and intended profiles intact. User requested PDF parser first even though smaller text utilities are simpler; sequence metadata gate before text/layout before lossless transformations. No external parser recommendation adopted. Native controls are development-only research and never shipping dependencies.

| Command plan | Core engine requirement | Main parity trap |
| --- | --- | --- |
| [fmt](safe-bash-fmt.md) | byte-word paragraph dynamic programming | cost arithmetic, sentence spacing, forced LF |
| [fold](safe-bash-fold.md) | explicit decoder/display-width tables | C versus UTF8, controls, retained separators |
| [diff3](safe-bash-diff3.md) | two independent diffs and three-way merge | middle-file base, flagged ed scripts, status |
| [csvcut](safe-bash-csvcut.md) | CSV dialect/parser/selector | missing/duplicate columns and padded rows |
| [csvgrep](safe-bash-csvgrep.md) | same CSV engine plus bounded patterns | physical line numbers and pattern semantics |
| [csvsort](safe-bash-csvsort.md) | exact inference/Decimal/date ordering | null/type order and stable ties |
| [csvstat](safe-bash-csvstat.md) | inferred types and Decimal aggregation | sample deviation, precision and null counts |
| [htmlq](safe-bash-htmlq.md) | HTML5 DOM, CSS grammar, serializer | inclusive removal and inert pseudo-classes |
| [unrtf](safe-bash-unrtf.md) | RTF stack, encoding, output configuration | legacy Unicode behavior and picture effects |
| [pdfinfo](safe-bash-pdfinfo.md) | shared PDF metadata/page graph | dates, permissions, geometry and modes |
| [pdftotext](safe-bash-pdftotext.md) | PDF glyph/font/CMap/layout extraction | reading order and mode-specific terminators |
| [qpdf](safe-bash-qpdf.md) | PDF parser plus graph writer/crypto | unreachable objects, scoped ranges, linearization |
| [exiftool](archive/safe-bash-exiftool.md) | per-format/tag registry and writers | duplicate priorities, identity, reversible PDF edits |
| [soffice](safe-bash-soffice.md) | Office layout and export filters | renderer fidelity and user-setting defaults |
| [tesseract](safe-bash-tesseract.md) | pixel segmentation and traineddata inference | float/quantized scores and dictionary beam decoding |
| [wkhtmltopdf](archive/safe-bash-wkhtmltopdf.md) | specified HTML/CSS print layout engine | patched Qt profile, pagination, resources and scripts |

These are implementation complexity assessments, not measured adoption statistics or delivered support claims. Every row retains its own pipeline plan. Common flags are part of a full pinned inventory: later engines may not silently drop an inconvenient native behavior.

## Research evidence ledger

This ledger counts retained observations, including expected errors and observed upstream defects. It does not count product tests or delivered support. Source inspection and original native/module controls are separate forms of evidence; source-only findings remain labelled in each command plan. A record-count audit corrected the initial CSV session tally to the 67 observations actually retained.

| Control family | Recorded observations | Qualification boundary |
| --- | ---: | --- |
| CSV parsing/selection/common flags | 67 | csvkit 2.2.0, agate 1.14.2, Python 3.9.6 |
| CSVgrep pattern grammar | 90 | Python regex and match-file behavior |
| CSVsort inference/ordering | 100 | Decimal, Unicode 13, dates, quoting interactions |
| CSV temporal inference/duration grammar | 103 + 15 | 87 direct casts +16 CLI observations; 15 multi-layer grammar cells, recorded2026-09-18 local reference date |
| CSVstat aggregate/serialization | 87 | LC_ALL=C, missing stats and output quirks |
| htmlq parser/selector/projection | 107 + 11 BOM-boundary controls | pinned 0.5.0 source and locked Rust dependency graph; enumerated cases only |
| GNU diff3 | 190 + 48 option/stdin controls | diffutils 3.12 and matching diff engine |
| GNU fmt/fold | 540 + 38 option + 90 fold state + 200 fmt byte-window + 144 fmt word-window controls | coreutils 9.10, C/UTF8 locale profiles |
| unrtf | 80 + 22 binary-boundary + 98 encoding + 21 decoder-buffer controls | released 0.21.10 and selected config profiles |
| ExifTool reads/scalar JSON | 138 + 60 | pinned 13.59, enumerated PNG/XMP/DOCX/raw cells |
| ExifTool writes/identity/PDF/DOCX | 12 + 5 + 5 + 1 | pixel preservation, inode/backup effects, reversible PDF update, unsupported DOCX write |
| qpdf structure/ranges/metadata | 82 + 49 + 6 + 83 JSON/attachment controls | pinned 12.4.2 development snapshot; not a released version claim |
| Poppler metadata/text | 326 + 34 text-branch controls | pinned 26.09.90 development snapshot, optional-feature-limited build |
| Poppler permissions/fonts/ActualText/encoding | 5 + 32 + 40 + 36 + 93 glyph-name + 12 variant + 36 numeric-name controls | alternate ENFORCE_PERMISSIONS utility and original text fixtures |
| PDF.js filters/predictors/lexer/CMap | 27 + 19 + 75 + 20 | direct pinned modules, not full-file compatibility |
| PDF.js AES/xref/R5-R6 hash | 12 + 20 + 18 | chunk defect/overflow controls and independent Node crypto comparison |
| Tesseract command/model/output | 76 + 17 | pinned5.5.3 snapshot, explicit fast English model, PBM/optional-codec-limited native build; no general accuracy claim |
| Leptonica primitives/fill limit | 112 + 26 | codec-free 1.86.0 oracle; no OCR accuracy qualification |

Each detailed plan retains source ownership, version pins, observed byte/status/effect rules and fixture reconstruction. Temporary source archives, build products and raw control output stay in task-owned out and are purged after durable capture. For reruns, fetch the same source pins, verify archive checksums, reconstruct original fixtures from the plan and record build options; do not substitute an arbitrary installed binary.

The htmlq plan has inspected Rust/HTML/selector dependency source and 107 controls from the pinned native build. LibreOffice source was inspected, but its isolated startup failed before conversion; no native conversion result is claimed. wkhtmltopdf pagination/outline/loading findings are source-only without a qualified patched-Qt binary. Tesseract model/segmentation source, Leptonica controls and the enumerated native bitmap recognition/output controls do not qualify a first-party traineddata implementation or general recognition accuracy. All such implementation and qualification tasks remain open. No external runtime parser or rendering dependency was adopted.


The final supplemental source audit verified all103 downloaded entries in the initial111-entry receipt inventory against their SHA256 hashes, with no mismatches. Eight initially unavailable entries are not counted as source inspection. Later pinned source reads extend that sparse inventory, including18 Writer-layout files and2 wkhtmltopdf handler/header files; the initial inventory was not a complete upstream tree. The full source archives used for native builds are separately pinned in the relevant plans. English OCR model bytes are4113088, and the Apache-2.0 LICENSE file SHA256 is `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`. Development oracle dependencies/models were never shipping dependencies.


## Implementation priorities

The most direct JavaScript rewrites are fmt, fold and diff3 because they operate on bounded byte/line algorithms. CSV selection/filtering is next, with shared dialect and selector primitives; inferred sorting/statistics add exact Decimal, Unicode, locale and calendar work. htmlq requires a complete admitted HTML tree/selector profile, and unrtf requires explicit codepage/personality profiles. The requested PDF parser remains the first shared engine to implement, followed by pdfinfo and pdftotext capability gates. qpdf adds a lossless graph writer, and ExifTool adds independently qualified format/tag writers. Office conversion, OCR and HTML printing need substantial rendering or inference engines plus versioned assets; their plans retain that scope and require separate fidelity evidence. These are engineering assessments from inspected source, with no measured popularity ranking or delivered compatibility claim.

A pre-delivery fetch observed remote main `a57fe895ed0629f22c81f2b4da81532671276387`. The pipeline schema/steps, safe-bash AGENTS policy, command/value/error contracts, package manifests, build/package declarations and PDF/Pandoc engines used by this ownership audit were unchanged from the initial baseline. New arithmetic/Playwright contract work is independent of these planned document engines and must be preserved during delivery. Recheck current main at implementation time.


## Canonical byte-argument ownership

Research duration: source investigation, original oracle controls and plan review began at 2026-09-18 11:23:54 UTC and continued through 2026-09-18 14:24:00 UTC. This exceeds the requested three-hour minimum. The final audit reconciled 3,528 retained observations across 50 control families; errors and upstream defects are included, not counted as product passes. All 18 plans remain draft with 128 open implementation tasks. Task-owned source archives, native builds and raw control scratch were purged after durable findings, source pins, reconstruction recipes and qualification boundaries were captured here and in the command plans.

Canonical argument source detail: getCommandArguments requires both the module-owned WeakSet brand and exact carrier.args===context.args identity. An adapter that recreates args with spread/map can fail admission despite equal strings; preserve the paired carrier/context or rebuild through the canonical factory with admitted allocation accounting. ByteShellValue owns copied bytes in a WeakMap and caches lossy UTF8 presentation using ignoreBOM=true; distinct invalid bytes can project to equal args strings. Command-specific byte semantics must consume carrier.bytes/values, not re-encode args; any decoded text policy is explicit. bytes() returns an owned copy with the supplied allocation contract, so account copies rather than treating it as a zero-copy borrow. Brand extraction must preserve reservation rollback/falsey errors and invocation lifetime, not only TypeScript shapes. The current string byte-length helper uses Buffer.byteLength; leaf extraction must retain the qualified runtime closure for each advertised consumer and verify its browser/workerd prerequisites, never assume that a private package manifest makes a Node-only global portable.

## inspect-build-contract: current-checkout evidence

Inspected checkout HEAD `8960ebd242ce1d3354babb2a741295c637d4eefc`. This section supersedes historical ownership descriptions above where extraction has already occurred; it records source inspection and graph validation, not release or command compatibility qualification. Only this inspection task is complete; subsequent implementation and packed-consumer gates remain open.

| Authoritative source | Current contract and integration consequence |
| --- | --- |
| `packages/safe-bash/package.json` | Explicit `./commands/wkhtmltopdf` and `./commands/exiftool` types/import routes already exist. `devDependencies` and `poeCode.integration.privateWorkspaces` explicitly admit these implementations and `safe-bash-contracts`, including exact version and dependency profiles. A new command requires its own explicit entries; workspace discovery alone does not admit it. |
| `packages/safe-bash/scripts/build.mjs`, `compilerInputs`, private workspace admission and `buildPackage` | Reads admitted metadata, source names and tool roots through the guarded compiler host. Private profiles admit bounded paired `dist/*.js`/`dist/*.d.ts` exports and declarations only, with identity/private/version/dependency checks. Keep this builder, `src` rootDir and `dist` outDir; do not glob sibling source or replace it with ordinary tsc. |
| `packages/safe-bash/integration-boundaries.json`; `packages/safe-bash/scripts/integration-inputs.mjs`, `loadBoundaries`, `readRegularInput`, `lintExclusions` | Held XAN source/evidence and authenticated fixture/inventory owners remain separate from admitted build roots. Do not reuse held CSV source, widen exclusions or bypass symlink/regular-file and owner checks. |
| Root `package.json`; `turbo.json`; `scripts/build-workspaces.mjs`, `createWorkspaceBuildPlan`, `createWorkspaceTestPlan` | `packages/*` discovers workspaces; build scripts and maintained `^build`/unit declarations determine execution. Local dependencies, devDependencies and optionalDependencies all create edges; workspace peers are rejected. Root build/test routes preserve closure and native lifecycle events. |
| `packages/safe-bash-contracts/package.json`; `packages/safe-bash-contracts/src/{command,value,io,output,plugin,command-requirements,filesystem,errors}.ts` | Exact private leaf owner is `safe-bash-contracts`. Canonical command/value implementations live here; filesystem/error exports forward to `@poe-code/safe-fs/core`, the sole manifest dependency. No shell parser/state or command ownership belongs in this leaf. |
| `packages/safe-bash/src/contracts/{command,value,errors}.ts`; `packages/safe-bash/src/contracts/{index,node}.ts`; `packages/safe-bash/src/core.browser.ts` | Existing public paths forward canonical contracts. Preserve all existing exports and constructor/runtime identities rather than recreating implementations at each entry. |
| `scripts/package-safe.mjs`, `rewriteModuleSpecifiers`, canonical private workspace handling, `addDependency` | AST-based rewriting copies qualified private JS and declarations into relative packed paths, validates profiles and rejects leaked bare private/CLI runtime imports. Browser bundles externalize canonical private owners before rewriting; this deliberately avoids duplicate brands. Existing op/pandoc special recipes are not a template for another command-name switch. |
| `packages/package-lint/src/rules/{no-published-to-private-dep,bundle-self-contained,shipped-dist-deps-unresolvable,imported-workspace-dep-unresolvable,no-cross-package-relative-import,exports-subpath-resolvable,runtime-file-assets-packaged}.ts`; `packages/package-lint/src/bundle-policy.ts` | Dependency/publication, bundle external edges, shipped resolution, package ownership, export resolution and assets have distinct gates. Canonical declaration traversal in bundle-policy currently concerns safe-fs; it is not proof of arbitrary command declarations. Do not exempt commands from maintained rules or confuse root CLI bundle validation with scoped packed validation. |
| `scripts/package-safe.test.ts`; `.github/workflows/release-safe.yml`; `scripts/fixtures/safe-packages-{mixed-entry-runtime,opt-in,optional,optional-no-yaml,browser,types}.mjs` (types fixture is `.mts`); `scripts/fixtures/safe-packages-opt-in.d.mts` | Maintained pack tests include memfs private-profile/declaration rewriting and canonical relative artifact checks. Release packs only safe-fs/safe-js/safe-bash and installs tarballs in isolated consumers for Node/Bun, strict NodeNext types and browser bundling. These generic routes need actual new-command coverage; their existence is not evidence that a future command passes them. |
| `scripts/verify-safe-publication.mjs` | Verifies the three scoped public libraries against registry metadata, integrity and provenance after GitHub publication. Private command/engine/contracts workspaces are not standalone publication candidates. |

The maintained `createWorkspaceBuildPlan(process.cwd())` completed successfully. Its relevant edges (consumer → prerequisite) are safe-bash → contracts, wkhtmltopdf and exiftool; wkhtmltopdf → contracts; exiftool → contracts and safe-fs; contracts → safe-fs. Its zero-based layers put contracts at 1, both command packages at 2 and safe-bash at 3. Neither command nor contracts has a safe-bash return edge. Future engines remain prerequisite leaves; declare every required first-party edge and rerun this planner before command integration. A development-only return edge is still a cycle.

For every newly added command, require manifest `name: safe-bash-command-<name>`, directory `packages/safe-bash-command-<name>`, `private: true`, ESM, paired runtime/type exports and maintained build/lint/unit scripts. The proposed public route is `@poe-platform/safe-bash/commands/<name>` (`./commands/<name>` in safe-bash exports), with a static facade forwarding its private implementation. The typed API is `create<Name>Command(options?: <Name>CommandOptions): CommandDefinition`; where plugin composition is needed, `<name>Commands(options?: <Name>CommandOptions): VirtualShellPlugin` performs registration. Options expose supported command limits/capabilities and explicit replacement policy where supported; registration must preflight collisions using the existing registry contract. Existing exiftool/wkhtmltopdf factories illustrate actual handler and plugin ownership, not a requirement to add redundant plural factories. SDK consumers register definitions or explicitly use the plugin; CLI integration must use that SDK path. Do not move existing commands or add a new command to default aggregates as part of this convention.

Zero external runtime dependencies is evaluated from the entire shipped JS/asset graph, not an empty command manifest. Qualified first-party source can be bundled or copied under canonical relative artifact paths; development tools and pinned native oracles remain outside the runtime closure. The current safe-bash artifact may depend on public safe-fs: that first-party boundary is distinct from an external parser dependency. Versioned fonts/models/codecs and license notices require explicit packed asset declarations and consumer checks before advertising rendering/inference support.

The leaf's current `shellValueByteLength` uses a Unicode loop, not the historical `Buffer.byteLength` implementation. `packages/safe-bash-contracts/src/value.test.ts` includes a Buffer-absent control. Preserve exact carrier/args reference pairing, WeakSet/WeakMap ownership, copied bytes, BOM-preserving lossy presentation, allocation reservations/rollback including falsey errors, and invocation lifetime. Test constructors and `commandRuntimeIdentity` across root/contracts/new-command imports from one installed artifact; root, browser and opt-in routes must reach one canonical owner per profile. TextEncoder/TextDecoder, typed-array intrinsics and the transitive safe-fs/core graph still require honest browser/workerd qualification; Buffer removal alone does not qualify a platform.

Before integrating a real new command, extend maintained packed consumers to prove the DAG's output without workspace resolution: import the subpath and strict declarations, register the typed factory, dispatch actual Shell-created byte argv with distinct invalid sequences, compare canonical errors/runtime identities, exercise VFS files/scripts/pipes/middleware, and verify denied ambient host capabilities and explicitly packed assets for each advertised profile. Keep the existing eight acceptance cases above. The current wkhtmltopdf/exiftool routes advertise types/import only; do not silently add browser/workerd conditions. PDF parser metadata remains the first implementation gate, then pdfinfo metadata, pdftotext text/layout, and finally lossless qpdf transformations. All 16 command plans, shared parser/package gates and intended profiles remain intact.

Inspection verification: maintained graph planner passed; `npx vitest run scripts/package-safe.test.ts` passed all 145 tests; the edited document passed `packages/pipeline/src/plan/parser.ts`'s `parsePlan`; `git diff --check` passed. No new tarball was installed and no browser/workerd runtime, release or publication was verified during this documentation task. Those remain explicit integration gates, not inferred passes.

## document-convention: adoption and acceptance

Candidate: checkout HEAD `35d01c57f8078d8afa916dc59929395d857e9c55` plus
the existing working-tree integration changes and this documentation update.
This is a working-tree qualification, not a frozen commit or released version.
The durable rule is `packages/safe-bash/AGENTS.md`; adoption does not authorize
publishing any private command workspace.

### Exact source layout and import boundary

| Owner | Layout and boundary |
| --- | --- |
| Canonical contracts | `packages/safe-bash-contracts/{package.json,tsconfig.json,tsconfig.test.json,LICENSE,README.md,src}`; private manifest name `safe-bash-contracts`. `src/{command,value,io,output,plugin,command-requirements,filesystem,errors}.ts` own the cohesive runtime/type closure; `src/index.ts` exposes it. Commands import `safe-bash-contracts/command`, `/value`, `/io`, `/output`, `/plugin` and `/errors` as needed. The only manifest prerequisite is `@poe-code/safe-fs`. |
| Real command packages | `packages/safe-bash-command-exiftool` and `packages/safe-bash-command-wkhtmltopdf`, each with `package.json`, source/test tsconfigs, LICENSE, user README and `src/index.ts`, real handler modules and unit tests. Both manifest names match their directory, version `0.0.1`, `private: true`, and export `.` as paired `./dist/index.d.ts` / `./dist/index.js`. Both declare maintained build, typecheck, lint, test and test:unit routes. |
| Safe Bash composition | `packages/safe-bash/src/commands/{exiftool,wkhtmltopdf}/index.ts` statically re-export their private command owner. Existing `src/contracts/*` paths forward to the contracts owner. `packages/safe-bash/package.json` explicitly declares private dependency profiles and `./commands/exiftool`, `./commands/wkhtmltopdf` paired types/import exports. No default registration follows from these facades. |
| Future command, proposed | `packages/safe-bash-command-<name>/{package.json,tsconfig.json,tsconfig.test.json,LICENSE,README.md,src/index.ts}` plus actual handler/tests. Proposed Safe Bash route `./commands/<name>` targets `./dist/commands/<name>/index.d.ts` and `./dist/commands/<name>/index.js`; it remains proposed until that command's installed consumers pass. No empty scaffolds or migration of existing commands. |
| Shared engines, proposed | Narrow private `packages/safe-bash-<domain>-engine` owners only where multiple consumers justify them. PDF parser and CSV Decimal/date/inference contracts retain their separate plans. Names and compiler admission remain proposed until implemented; engine types are not automatically admitted by adding a workspace edge. |

The maintained build and unit planners both accepted the candidate DAG.
Dependencies and development dependencies count equally for cycle detection:
Safe Bash depends on both commands and contracts; both commands depend on
contracts; ExifTool and contracts additionally depend on SafeFS. Neither command
nor contracts depends back on Safe Bash. Every discovered `safe-bash-command-*`
manifest (the two above) is private and has its own user README. This task creates
no new command package. `safe-bash-command-private` is registered in package-lint;
privacy enforcement is independent of whether an export profile exists.

`packages/safe-bash/scripts/build.mjs` admits reviewed private dist declarations,
not sibling source. Its current profile-name admission accepts contracts and
command owners; a future shared engine declaration closure needs explicit review.
`integration-boundaries.json`, `scripts/integration-inputs.mjs` and exact
integration test membership remain authoritative; held XAN/evidence paths are
not reusable parser inputs. The root `scripts/rewrite-workspace-dts.mjs` and
`scripts/rewrite-workspace-runtime.mjs` use workspace export and canonical SafeFS
routes; their success alone does not qualify a scoped tarball.

The scoped packer `scripts/package-safe.mjs` validates exact private profiles and
AST-rewrites runtime and type specifiers into relative `dist/<workspace>/*`
artifacts. `scripts/bundle-safe-bash.mjs`'s `resolvePrivateCommandBuild` supplies
the reusable types/import-only command recipe. Canonical contracts remain
external to each individual bundle and enter the packed relative graph once.
Do not independently inline brands into each command. Public consumers import
Safe Bash subpaths, never the private manifest names.

Preserve canonical WeakSet/WeakMap ownership, constructor/runtime identity,
paired `carrier.args === context.args`, owned byte copies, reservation rollback,
falsey errors and invocation cleanup. The extracted current string-byte helper
is Buffer-free; historical Buffer observations above describe the earlier
source. That change alone proves no browser/workerd portability.

Zero dependencies applies to the complete shipped command implementation and
asset closure, not just its manifest. First-party code may be bundled; development
tools, upstream oracles and native programs never become runtime dependencies.
Existing optional plugins retain their explicit capability/dependency contracts.
Fonts/models/codecs need versioned asset and licensing gates before admission.

### Current-candidate acceptance gates

Run shared gates sequentially: `TURBO_FORCE=true npm run build` disables the
maintained workspace cache while preserving all root suffix stages;
`npm test -- --no-cache` runs the complete maintained unit closure and native
pre/post events, including root posttest. For uncached repository lint use
`npm run lint:eslint -- --no-cache`, then `npm run lint:types`
and `npm run lint:workflows`; also run `npm run lint:packages`. Run the root
type-lint compiler additionally with `npx tsc -p tsconfig.build.json --noEmit
--incremental false` to avoid its incremental receipt. These are the maintained
root lint constituents, not a hand-picked source subset.

Installed-artifact qualification follows `.github/workflows/release-safe.yml`:
stage with `scripts/package-safe.mjs`, npm-pack SafeFS/SafeJS/SafeBash, install only
those public tarballs in a consumer outside the checkout, and run maintained
smoke, private-command, publication-boundary and registration fixtures plus
strict NodeNext declaration consumers. Check no private workspace was installed,
no bare private import remains, canonical identity and byte argv are preserved,
and registration is opt-in. Packed export evidence is required before the README
recommends an exact command import.

Node-hosted browser/workerd export-condition or VM checks are conditional graph
evidence only; actual browser/workerd engines require independent qualification.
Do not add conditions, weaken tests, raise deadlines or infer publication from
passing local consumers. Missing declarations, optional skips and unavailable
runtime cells are recorded separately. Final architecture acceptance stays
pending until every required current-candidate gate passes. All 16 command plans,
PDF metadata → text/layout → lossless transformation ordering, intended profiles
and shared parser/package gates remain intact.

Temporary evidence uses ignored `out/document-convention` because `/out` is
unavailable on this host; task-owned output is purged after recording results.

### Fresh installed export evidence, 2026-09-19

`scripts/package-safe.mjs --version 0.0.0-document-convention` staged the
candidate; `npm pack --ignore-scripts` produced three public tarballs, installed
offline with scripts disabled into a fresh OS temporary consumer outside the
checkout. No private contracts/command workspace was installed. The maintained
`safe-packages-smoke.mjs`, `safe-packages-publication-boundary.mjs` and
`safe-packages-registration.mjs` passed, including their private-command fixture.
Strict NodeNext consumers `safe-packages-types.mts`,
`safe-packages-private-command-types.mts` and `safe-packages-registration-types.mts`
passed together with strict optional properties and unchecked indexed access.

The actual packed routes (different from checkout manifest target paths) are:

| Verified export | Packed types | Packed ESM import |
| --- | --- | --- |
| `@poe-platform/safe-bash/commands/exiftool` | `./dist/safe-bash/commands/exiftool/index.d.ts` | `./dist/safe-bash/commands/exiftool/index.js` |
| `@poe-platform/safe-bash/commands/wkhtmltopdf` | `./dist/safe-bash/commands/wkhtmltopdf/index.d.ts` | `./dist/safe-bash/commands/wkhtmltopdf/index.js` |

These two imports are verified for this locally installed candidate; they do not
establish published-version availability or complete command compatibility.
Tarball SHA256 receipts for version `0.0.0-document-convention`:

- Safe Bash: `4dde1e715c7d9ec307b487d54ee18d66ca2c9d7ed406f547595ab092a7948816`.
- SafeFS: `99b319d6946d0a09143b46b8cb5d576374fa05e84a87a464722d9097422f803a`.
- SafeJS: `f13eb0821e14d26354b8eebf5f8cffef78eeacee9e82cf69aae4aa2a06b5a03e`.

The new README example in its existing opt-in section was extracted verbatim
and executed from that consumer: explicit `wkhtmltopdfCommands()` registration,
`wkhtmltopdf --help` and disposal succeeded without a renderer. Both real command
packages already have usage-first READMEs, supported profiles and honest limits.

An AST inspection of all 1,246 packed Safe Bash JS/declaration files found no bare
private command/contracts specifiers. Canonical error constructors/runtime
identity, recreated carrier rejection, owned byte copies, distinct invalid
UTF8 values, Shell-created byte argv, PNG execution, collision preflight,
replacement, unchanged defaults, middleware and VFS script/pipeline execution
passed through the maintained installed fixtures. These cases establish package
integration, not full host-isolation/replay or upstream compatibility coverage.

The workflow's browser/workerd condition bundles passed in Node VM realms with
TextEncoder/TextDecoder and explicit web capabilities, without Buffer, process or
require. These are Node-hosted conditional graph checks; actual browser/workerd
engines remain unqualified. Bun was unavailable and is not counted as a pass.

**Acceptance finding:** the complete packed Safe Bash manifest declares
`@poe-platform/safe-fs`, `pako`, `@types/node`, `@noble/hashes`,
`@kayahr/text-encoding` and `jsonc-parser`. Packed
`dist/office-package/compression.js` imports `pako` at runtime; bundled graphs also
contain upstream implementations. Thus no whole-artifact zero-external-runtime-
dependency claim is accepted. An empty command dependencies object and passing
installed consumers do not discharge this gate. This documentation task records
the concrete finding without speculative changes to unrelated engines, manifests
or optional registration. Shared gates and final acceptance remain separately
reported below; future command exports stay proposed.

### Maintained verification receipt

- `TURBO_FORCE=true npm run build`: exit 0, including guarded workspace builds
  and root codegen/compiler/bin-wrapper/bundle stages. Missing build declarations
  remain reported by the maintained runner rather than counted as passes.
- `npm run lint:eslint -- --no-cache`: complete, exit 0, zero errors, four
  warnings, zero cache hits. The guarded receipt reports all 16,040 configured
  subjects linted, with no unprocessed inputs.
- `npm run lint:types`, additional nonincremental root typecheck,
  `npm run lint:workflows` and `npm run lint:packages`: each exit 0.
- Maintained build/unit graph planning, private flags/user READMEs,
  `parsePlan` (six tasks) and `git diff --check`: passed.
- Installed artifact runtime/types and conditional realm results are scoped
  above. Bun, actual browser/workerd engines and release availability are
  unverified. Tarballs were staged before the README-only example addition;
  that exact example was then executed against the installed runtime.

`npm test -- --no-cache` completed with exit 0, including declared workspace
prerequisite builds, native pre/post events and root posttest's two lint-stress
checks. The maintained runner explicitly reported `cache: "UNCACHED"`, 82
workspaces, 30 prerequisite builds and 50 unit routes; missing build/unit
declarations remain marked `NOT_A_PASS`. These counts describe this receipt and
do not define future task membership. Shared batches retained two skips.
Safe Bash reported 41,882 passes, 829 skips and zero failures, plus all 558 guarded
runner checks passing. SafeJS reported 31,121 passes and 48 skips across 1,470
files (three skipped files). Safe Python passed all 84,595 cases across 1,151
files. No focused rerun substitutes for a failed broad gate;
this complete route passed without changing code, assertions or deadlines.

Documentation adoption and current Node package integration are evidenced above.
Finalization and this task's architecture acceptance remain pending for the
zero-external-runtime-dependency finding and unfinished advertised-runtime
qualification. Future commands still need their own installed-artifact/profile
gates; none are admitted by this receipt. Local commits: none. Verified
remote-main delivery: none. Successful releases: none. No standalone private
publication was performed or authorized. Task-owned logs, staged packages,
tarballs and the external temporary consumer were purged after durable capture.
