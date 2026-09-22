# engine-pdfinfo prerequisite inspection

Inspected the current workspace on 2026-09-21. Engine implementation is blocked by missing accepted shared parser APIs. This report does not close implementation, testing or compatibility gates.

The requested [pdfinfo plan](safe-bash-pdfinfo.md:29) requires consuming accepted private parser page/metadata/encryption APIs. Its execution rule says: “prerequisite plans must pass their stated acceptance gates before dependent integration.”

## Current evidence

| Required boundary | Inspection result |
| --- | --- |
| Shared parser implementation | Neither `packages/pdf-parser` (the parser plan's proposed location) nor `packages/safe-bash-pdf-parser` exists. `ls` and `rg --files` report missing directories. |
| Page tree and metadata | [Parser page-tree task](safe-bash-pdf-parser.md:89) remains open for implementation, refactoring and testing. There is no accepted parser API to obtain resolved Info strings, metadata streams or inherited page geometry. |
| Applicable security | [Parser security task](safe-bash-pdf-parser.md:113) remains open for implementation, refactoring and testing. There is no accepted parser authorization/encryption contract to consume. |
| Parser public contract | [Parser API task](safe-bash-pdf-parser.md:231) remains open. Byte ownership, invocation-total accounting, cancellation and document cleanup cannot be integrated against an accepted implementation. |
| Command and export | Package source inventory contains no pdfinfo command workspace. Searches of root and safe-bash manifests and `scripts/bundle-safe-bash.mjs` found no pdfinfo/parser integration. |
| Package convention | The requested original package-pattern path is absent; [the archived copy](archive/safe-bash-command-package-pattern.md) was read without restoring unrelated deletions. It requires shared engine ownership and prohibits empty command scaffolds. |

The existing `packages/pdf` is a rendering package, explicitly distinguished from the proposed parser in the parser plan. It does not establish the required inspection gates. Supplied Poppler controls qualify reference behavior; they do not establish first-party parser acceptance.

## Required handoff

Accept and qualify the shared parser's page tree, raw lexical string bytes/source provenance, resolved metadata streams and applicable security APIs first. The contract must distinguish unknown, absent and false facts, expose unsupported capabilities, preserve original stream bytes and enforce invocation-total limits with explicit cancellation and cleanup.

Then write fast original failing engine tests against those APIs, using memory VFS and mocked capabilities. Cover PDFDocEncoding and admitted BOM text roles, malformed UTF-16 boundaries, explicit PDF date offsets, unknown/absent/false facts, raw metadata preservation versus CLI NUL truncation/sanitation, inert XMP handling and tagged flags versus validated structure. Keep unqualified language escapes, output encodings and structure/security cells explicit.

Implement in private ESM `packages/safe-bash-command-pdfinfo`, package name `safe-bash-command-pdfinfo`, with no external runtime dependencies. Safe-bash must only compose/export it at `@poe-platform/safe-bash/commands/pdfinfo`; verify bundled runtime and declarations with an isolated installed consumer lacking the private workspace. Preserve CLI/SDK fact parity and explicitly separate actual input byte length from native-compatible stdin file size zero.

Only this evidence document was added. No speculative parser contract, duplicate engine, empty scaffold, missing-module test or runtime implementation was introduced. No tests, builds, screenshots, commits, pushes or publications were performed. The engine task remains incomplete pending its stated prerequisites.

## Task review revalidation

Revalidated against the current workspace on 2026-09-21 for the engine-pdfinfo implementation/review request. The prerequisite blocker still holds: directory checks find no `packages/pdf-parser`, `packages/safe-bash-pdf-parser` or `packages/safe-bash-command-pdfinfo`. Source and package-manifest searches find no parser or pdfinfo integration; the root manifest, safe-bash manifest and bundle script also have no such references. The parser plan's page-tree, security and private API implementation/refactor/test gates remain open.

An additional unresolved finding is the pdfinfo plan's `engine-pdfinfo` status: `implement: done` at line 42 is inconsistent with the absent implementation and unmet parser gates. That existing contributor edit was preserved. It is not evidence of completion; engine implementation, review and acceptance remain blocked.

There is no engine task code diff to review for abstractions, proxy functions, duplicated parsing, host access or compatibility regressions. Failure paths, cancellation, budgets, ownership, snapshot/version compatibility, CLI/SDK parity and installed-consumer bundling cannot be verified without the prerequisite parser and command implementation. No code or tests were added, and no checks were claimed as passing. This review only updates this evidence document; it does not close any gate.
