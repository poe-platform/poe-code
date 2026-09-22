# command-qpdf wiring prerequisite verification

Inspected the working tree on 2026-09-21 at HEAD
`ab1fa8d34101e1e7f61272973f3bc28a842043d8`. The requested command wiring is
**not implemented**. Existing plan status edits are preserved; they do not
establish an engine available for composition.

## Current evidence

| Boundary | Executed inspection | Result |
| --- | --- | --- |
| Command implementation | Filesystem existence check for `packages/safe-bash-command-qpdf` | Absent. No actual engine or CommandDefinition exists to wire. |
| Composition and exports | Filesystem check for `packages/safe-bash/src/commands/qpdf/index.ts`; JSON-parsed safe-bash manifest | Entry absent; `./commands/qpdf` export and `safe-bash-command-qpdf` dependency absent. Root development dependency is also absent. |
| Shared PDF parser | Search package TypeScript outside generated dist for `parsePdf`, `parsePDF`, `PdfParser`, `PDFParser`, `rawObjects`; inspect `packages/pdf/src/index.ts` | No matching parser API. The PDF package supplies layout rendering using external libraries, not existing-document raw objects or revisions. |
| Parser readiness | Inspect `docs/plans/safe-bash-pdf-parser.md` | `pdf-byte-syntax`, `pdf-revisions`, and `pdf-parser-api` implementation remain open. |
| Existing serializer | Inspect `packages/pdf/src/serialization.ts` | Imports `pdf-lib`; rejects sparse identities, nonzero generations, Encrypt and ID; emits only Root/Info trailer entries. It is not the requested first-party graph writer. |
| Runtime dependencies | JSON manifest and source inspection for `packages/pdf` | `pdf-lib`, `@pdf-lib/fontkit`, and `pako` prevent adopting the renderer as a zero-external-dependency qpdf engine. |

The requested package-pattern document has been moved in unrelated edits. Its
available [archived counterpart](archive/safe-bash-command-package-pattern.md)
says “Do not create empty command scaffolds” and requires a real command
candidate for bundled integration. An unsupported-only handler, injected host
executor, or fabricated parser contract would not meet this task. This is an
implementation prerequisite, not a request for approval.

## Required integration after engine qualification

Consume the actual shared parser and qualified command-owned graph writer.
Start command code with failing memory-VFS tests for native exit statuses,
scoped argv grammar, strict unknown-option failures, literal paths and SDK/CLI
equivalence. Input stdin must be rejected according to the pinned qpdf
semantics; permitted output `-` uses awaited byte writes. Test cancellation,
producer ownership, budgets and cleanup before owned acquisition, and staged
identity-aware publication before admitting transforms.

Keep the implementation in the private ESM `safe-bash-command-qpdf` workspace,
using the canonical `safe-bash-contracts` leaf rather than importing safe-bash
back into the command. Safe-bash adds composition and the explicit command
subpath only. The current qualified build reads
`poeCode.integration.privateWorkspaces` in
`packages/safe-bash/scripts/build.mjs`; packaging and private implementation /
declaration handling live in `scripts/package-safe.mjs`. Integrate through
these maintained paths and verify isolated installed runtime and type consumers,
including canonical argument/error identity and absence of unpublished package
imports. Keep default registration unchanged and do not publish this workspace.

Retain all 140 option entries and all existing acceptance cells as open until
their implementation and independent controls pass. The supplied pinned native
observations constrain behavior; they do not qualify missing first-party code.

## Verification limits

This increment adds only this evidence document. No runtime, manifest, existing
plan, registration or publication changes were made. No TDD cycle, tests, build,
native control rerun, screenshot, installed-consumer verification, commit, push
or release is claimed. All unrelated edits were preserved.
