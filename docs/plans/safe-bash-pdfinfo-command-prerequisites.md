# command-pdfinfo wiring prerequisite inspection

Revalidated the current working tree on 2026-09-21 for the requested CLI/SDK and installed Safe Bash export. Implementation remains incomplete.

## Verified evidence

- `rg --files packages` finds no source under `packages/pdf-parser`, `packages/safe-bash-pdf-parser` or `packages/safe-bash-command-pdfinfo`. There is no inspection engine or command API to compose.
- Searches of `package.json`, `packages/safe-bash/package.json`, `packages/safe-bash/scripts/build.mjs` and `scripts/bundle-safe-bash.mjs` find no pdfinfo or shared PDF parser integration.
- The shared [parser plan](safe-bash-pdf-parser.md) still has open page-tree, security and private API implementation/refactoring/testing gates. These are explicit prerequisites in the requested task; supplied native controls qualify reference behavior, not the missing first-party implementation.
- The original package-pattern document is absent after an unrelated move. Its [archived copy](archive/safe-bash-command-package-pattern.md) requires accepted shared engine ownership and says “Do not create empty command scaffolds or mass-migrate existing commands.” The move was preserved.
- The adjacent pdftotext package does not satisfy the parser gates: `packages/safe-bash-command-pdftotext/src/command.ts` declares `extractionQualified: false` and raises `Qualified PDF font/text/layout engine is unavailable` for extraction. Admission/encoding helpers do not resolve PDF metadata, page geometry or security.

## Required integration handoff

First implement and qualify the shared parser and pdfinfo engine with resolved metadata streams, byte-preserving lexical strings, inherited page geometry, authorization and invocation-wide ownership/accounting/cancellation/cleanup. Do not infer these facts from byte-substring searches or a rendering package.

Then drive the actual private `safe-bash-command-pdfinfo` CommandDefinition and equivalent typed SDK through failing memory-VFS tests. Wire only composition/re-exports in Safe Bash. The current maintained integration path consists of the command workspace dependency, `./commands/pdfinfo` export, private-workspace `poeBuild` input declarations in `packages/safe-bash/package.json`, and `packages/safe-bash/src/commands/pdfinfo/index.ts`; the guarded builder and `scripts/bundle-safe-bash.mjs` must admit and bundle that closure. Use the existing private declaration rewriting/publication checks and isolated installed consumers to prove no unpublished import escapes. Keep canonical contract identities and default registration unchanged.

Leave full argument/output/native-status acceptance, explicit locale/timezone, raw metadata preservation, stdin compatibility size versus actual input length, producer byte ownership, cancellation, resource limits and realm/replay gates open until exercised against that implementation. The existing engine/behavior completion labels are not proof of implementation when the source is absent; unrelated plan edits were preserved.

Only this evidence document was added. No placeholder command, speculative parser contract or missing-module test was introduced. Runtime tests, lint/build checks, screenshots and packed-consumer checks were not run because no pdfinfo implementation exists to exercise. Local commits: none. Verified remote-main delivery: none. Successful releases: none. No package was published.

## Command task diff review

Revalidated on 2026-09-21 for the command-pdfinfo review request. `rg --files packages` contains no pdfinfo command or shared PDF parser source. Searches of the root manifest, Safe Bash manifest and bundle script still find no pdfinfo/parser integration. The adjacent pdftotext implementation remains explicitly unqualified for extraction and supplies no accepted metadata/page-tree/security API.

Blocking finding: the current diff marks `command-pdfinfo` implementation `done` in [the plan](safe-bash-pdfinfo.md:82), despite the absent command package, typed SDK, Safe Bash subpath and installed-artifact integration. Engine and behavior completion claims likewise have no implementation evidence. Existing contributor edits were preserved; these statuses cannot close acceptance gates.

There is no command code diff to simplify or assess for abstractions, proxy-only functions, duplicated logic, host access or compatibility regressions. Failure paths, cancellation propagation, awaited sink writes, cleanup-before-acquisition, producer byte ownership, invocation budgets and snapshot/version compatibility remain unverified. CLI/SDK equivalence, native output/status compatibility and bundled private runtime/declarations remain open.

The task explicitly requires parser metadata/security/page-tree qualification before dependent integration; the archived package pattern also prohibits empty command scaffolds. Implement and qualify those shared parser APIs before the real command/export increment. No placeholder implementation or missing-module test was added. Only this review record changed; `git diff --check` on this file passed. No runtime tests, builds, screenshots, installed-consumer checks, commits, pushes or publications were performed. The unresolved prerequisite and unsupported completion status block completion.
