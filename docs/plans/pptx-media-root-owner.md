# Media replacement for root-owned parts

Ownership: `packages/pptx/src/media-editing.ts` only for the package URI import
and two relationship-directory arguments; original
`packages/safe-bash/tests/commands/pptx/media-root-owner.test.ts`, its exact
registration, and this plan. Preserve the root owner's concurrent track-binding
validation changes in the same source file. Root controls commits.

## Validated finding and change

The caption CLI QA found a valid original package whose slide part is directly
at `/slide.xml`. Existing media replacement passed `owner.slice(0, lastSlash)`
as the relationship base, producing an invalid empty string. Both public SDK
`replaceMedia` and the injected `pptx media replace` command failed `unsafe-path`.
The isolated two-case regression reproduced both failures before source edits;
the SDK stack reached `relativePartReference`, and CLI returned operational
failure status 1 instead of success.

Use the existing validated `packageUri(owner).baseURI`, which represents the
package root as `/`, in the two media relationship writers. This does not weaken
path validation or introduce special casing by provider or product identity.

The small original memfs fixture includes complete root-owned presentation,
slide, master/layout relationships and two independently authored caption
payloads. SDK assertions inspect ZIP member payloads independently and verify
both new media bindings and the poster; CLI asserts successful binary output,
root slide ownership, surviving captions and byte-identical original input.
No corpus files, downloads or host filesystem product access are involved.

## Checks

1. Red: `node --import tsx --test --test-concurrency=1 packages/safe-bash/tests/commands/pptx/media-root-owner.test.ts`:
   two failures, `unsafe-path`, approximately 0.8 seconds.
2. Build the selected maintained closure with
   `npm run build:workspaces -- --workspace=pptx`.
3. Run the root-owner, track-preservation and existing media-inventory CLI files
   together through `node --import tsx --test --test-concurrency=1`.
4. Run the exact integration registration guard. Root coordinates package lint
   and relevant SDK tests; no whole pipeline is requested.

The unchanged two-case test file already passed the maintained full
`npm run typecheck --workspace=virtual-bash` source/tests and 26 consumer-group
route before the source fix. The original task's root guarded ESLint gate
stopped at its fixed subject cap; this remains a commit blocker. Do not alter
guard limits, bypass checks, commit, push or release from this worker.

Green receipt: selected build closure passed all three tasks; the three focused
CLI files passed all 10 cases (approximately 2.5 seconds), including both formerly
failing root-owner cases. Exact integration registration passed all 107 cases
(approximately 19.9 seconds). Scoped source/registration diff whitespace check
passed. No new tests, fixtures or source behavior beyond this bounded fix were
required after the maintained virtual-bash typecheck pass.
