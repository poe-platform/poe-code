# Bounded DOCX signature inventory and explicit removal

Scope: F43 utility behavior only, under `docs/specs/docx.md`,
`docs/specs/office-cli.md` and `docs/specs/office-sdk.md`. Later tasks remain
pending. This record restores the missing target of existing specification and
API-audit links; it does not replace historical evidence.

## Current implementation

`packages/docx/src/signatures.ts` owns package-global signature inventory and
isolated graph removal. The public SDK exports `inspectDocumentSignatures` and
`stripDocumentSignatures`; the shared command engine exposes `signatures list`
and `signatures remove`. The safe-bash adapter only supplies explicit invocation
capabilities. No singular resource or top-level strip alias is added.

Inventory uses exact OPC signature content types and relationship roles, not
folder names or payload cryptography. It reports origin, signature, certificate
and otherwise declared target parts, inert relationship metadata and
`verified: null`. External targets are redacted and never fetched.

Ordinary publication rejects signed baselines, including attempted implicit
removal. Separate explicit removal plans all signature parts, their owned
relationship parts, signature edges and affected content-type declarations.
Unsupported outgoing or shared incoming edges and document-owner overlap reject
before publication. Protection and package validation remain enforced. Dry-run
reports precise effects without writing. Atomic VFS publication preserves existing
files on precommit failure; binary stdout has the shared transport limitation.
No verification or signature regeneration is implemented.

## JavaScript and security mappings

- Acquisition/publication is always async and uses admitted `Uint8Array` bytes
  and explicit VFS/sink capabilities; no ambient host I/O, native executable,
  identity, clock or product network capability is acquired.
- Utility options retain camelCase mappings of common CLI flags, including
  `dryRun`, `inPlace` and `allowEmpty`. Snapshot inventories and effect receipts
  are readonly typed arrays, not new live model owners.
- Locations use SHA-256 admitted-source identity. `verified: null` means
  cryptographic validity is unknown, including well-formed unrecognized payloads.
- Missing removal selection uses `missing-selection`; unsafe graphs and signed
  ordinary edits use `unsupported-edit`, with common CLI status 1. Usage,
  resource-limit and publication failures retain their shared categories.
- The pinned `upstream-api-inventory.json` has no signature-specific public owner.
  Package/OpcPackage and Part/XmlPart retain their recorded security mappings.
  Inherited members, enums, collections, helpers, APIs without reference tests
  and documented underscore-prefixed public types keep their existing obligations.
  Neutral model spellings and documentation-error dispositions remain unchanged;
  this utility task establishes no whole-public-API completion.

## Original acceptance and verification

The existing implementation already passes the added behavioral probes. No
failing product regression was established, so no product rewrite is justified
under the failing-tests-before-code rule.

`signatures.test.ts` retains all original cases for multiple signatures, unusual
payloads, encoded names, external declarations, shared/unsupported edges,
protection, invalid XML, admission failure and atomic publication failure. The
additional mutation-during-admission case verifies that stripping uses owned
baseline bytes and publishes a link-consistent unsigned package.

`signatures-command.test.ts` adds public CLI/SDK inventory and exact dry-run
receipt parity for the original multiple-signature fixture, plus common error
envelopes/statuses for signed edits and unsafe stripping. All unit mutations use
memfs. No downloaded fixture or reference runtime is required.

The existing safe-bash signature workflow additionally exercises VFS scripts,
in-place removal, binary stdout, output-limit preservation and a separate text
edit after removal. Later model/signature-batch tasks and cryptographic
verification/regeneration remain outside this task.

Executed checks on 2026-09-21 before the owned local commit:

- `npm test --workspace=docx`: 247 files, 5,160 tests passed.
- `npm run lint --workspace=docx`: passed ESLint and both TypeScript checks;
  one existing unused-variable warning in `operation-types.test.ts`.
- `npm run build:workspaces -- --workspace=docx`: selected maintained build
  closure passed.
- `node --import tsx --test packages/safe-bash/tests/commands/docx/signatures.test.ts`:
  both existing workflows passed.

No product CLI rendering changes are made. No push or release is authorized.
