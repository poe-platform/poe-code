# Opaque media type CLI regression

Ownership: `packages/safe-bash/tests/commands/pptx/opaque-objects.test.ts` and
this plan. Root owns the domain normalization, SDK tests, research accounting
and any local commit. No staging, push, release or whole pipeline execution
belongs to this worker.

The original CLI regression constructs five ZIP members independently, including
an inert three-byte part, an unknown relationship and the declaration
`APPLICATION/VND.MS-OFFICE.VBAPROJECT;version=1`. No signature or recognized
relationship can classify the part. The plural `objects list` JSON operation must
report exactly one `active-payload`, retaining the complete original content type,
byte length, owner, empty closure and the declaration-based active reason.

The test uses memfs through an injected virtual filesystem, verifies exactly one
input read and preserves the input bytes. A throwing global fetch trap records
zero calls. No native process or network provider is registered. This check does
not intercept every Node host-file/process primitive; the broader denied-capability
evidence remains a separate domain obligation. No fixture is downloaded or shipped.

Consulted root and scoped AGENTS, the pptx and shared office contracts, the test
and API audits and inventories, and the corpus manifest. This additional hostile
declaration regression does not replace the existing expanded-case/API accounting
or establish whole-public-API coverage. Assets and wording are independently
authored; no substantial copied material is introduced.

## Verification procedure and results

1. Run the exact test file with the maintained node:test/tsx harness. Before the
   fix, five existing cases passed and the new case failed: zero objects instead
   of one. After root's selected maintained pptx workspace build, all six passed
   in about 0.9 seconds:
   `node --import tsx --test --test-concurrency=1 packages/safe-bash/tests/commands/pptx/opaque-objects.test.ts`.
2. Run `npm run typecheck --workspace=virtual-bash` for maintained source, test
   and public consumer declarations. Record the completed result below.
3. Run `npm run lint:eslint`; if its bounded whole-root traversal cannot complete,
   report that separately and run the existing guarded changed-file API with the
   unchanged root config, all boundary receipts and the literal owned test path.
4. Capture actual injected `pptx help objects list` through `npm run screenshot`
   with `--no-header --output .cache/pptx-opaque-media-type-help.png`, invoking
   node/tsx with a bounded engine and MemoryFileSystem. The inspected image has
   complete legible usage, scope, inert handling and publication guidance. This
   is help-layout QA; classification is asserted by the CLI JSON regression.
   The image is disposable and must not be staged.

Maintained safe-bash reporter:
`node packages/safe-bash/scripts/test-reporting.mjs --import tsx packages/safe-bash/tests/commands/pptx/opaque-objects.test.ts`
passed all six cases. An initial invocation placed the TS loader before the
reporter instead of forwarding it to its child; that invocation failed module
resolution. Correct forwarding passed without source changes.

Maintained typecheck completed successfully: source/tests, 26 public consumer
groups, expected negative type cases and clean temporary cleanup. Zero builds
and runtime executions were reported; this is declaration verification.

Guarded exact changed-file lint passed with zero errors/warnings, all 25 boundary
receipts, 2,007 matched opens/closes, `receiptsComplete: true`, `failed: false`.
The unchanged config and existing guard API admitted the single literal test
path. Subject SHA-256:
`c978ebe434c80bd72db05cd7e7df687558dcbf15ab13ddfb94b52282335237de`
(10,328 bytes). This scoped result does not establish a complete root lint run.
`git diff --check` passed for the two owned paths.

Whole-root `npm run lint:eslint` completed with exit 2 at the fixed subject cap:
12,001 configured inputs, 12,000 linted, zero reported errors/warnings,
`complete: false`, `failed: true`, and all receipts complete. The last admitted
subject was `packages/agent-skill-config/src/apply.ts`; 14,060 opens and closes
matched. Its verbose result exceeded the tool output capture and was truncated.
This is an incomplete lint gate, not a clean whole-root result. No guard limit,
configuration or input selection was changed. The separate guarded exact-file
pass above is the scoped lint evidence for this atomic improvement.
