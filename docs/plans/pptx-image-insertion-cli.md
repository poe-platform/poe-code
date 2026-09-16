# Image insertion CLI implementation and QA

Scope: implement `images add` in the existing package command engine and verify
its safe-bash integration. The generic safe-bash adapter retains VFS admission,
source identity protection and conditional publication; it needs no new image
logic. The SDK owner supplies `addImage` in `packages/pptx`.

## Contracts and research

Read root and safe-bash AGENTS, `docs/specs/pptx.md`, `office-cli.md`,
`office-sdk.md`, the test/API audit summaries and the corpus manifest. Broader
source-case and public-member reconciliation stays with the research owner.
This CLI slice does not claim complete image or public-model coverage.

The route accepts `--slide`, `--file`, optional explicit `--content-type`, placement,
sizing, fit and alternative text. PNG/JPEG/GIF filename extensions provide MIME
when omitted, including uppercase extensions. The SDK validates actual bytes.
Unknown extensions require explicit MIME. Two dimensions require explicit fit;
one dimension preserves aspect. Package mutation publication uses existing
output, force, in-place, dry-run and binary-stream rules. Image sources are protected
against output aliases, including when the destination is force-authorized.

## Executed evidence

- TDD: the original memfs command cases first failed because `images.add` was
  unsupported. After implementation all 10 cases passed. A later empty-alt-text
  case failed with `Missing option value`; accepting an explicit empty alternative
  text for this operation repaired the observable SDK/CLI difference.
- Original byte asset: one authored transparent GIF pixel, no downloads or copied
  reference asset. Assertions independently check exact EMU corner coordinates,
  alt text, media type, original input retention and schema result validation.
- `node --import tsx --test --test-concurrency=1
  packages/safe-bash/tests/commands/pptx/create.test.ts
  packages/safe-bash/tests/commands/pptx/image-inventory.test.ts`: 49 passes.
  The new script case exercises quoted Unicode image paths, SDK byte equality,
  independent contain coordinates, dry run, protected image destinations,
  mismatched content type without publication and a binary package pipeline.
- `npm run build:workspaces -- --workspace=pptx`: passed all three tasks after
  the admission owner's strict-index fixes. Root coordinates final maintained
  package test/lint runs after workers finish.
- `git diff --check`: passed.

## Visual QA procedure and result

Invoke the built command engine with `images add --help` and an invalid unit
request (`--width 2 --dry-run`) using a read capability that throws if called.
Render the actual stdout/stderr using the same `terminal-png` renderer used by
`scripts/screenshot.ts`. Inspect both PNGs. This directly exercises the virtual
utility because the root `poe-code` command is not its invocation surface.

Executed screenshots: `.cache/pptx-image-cli-qa/help.png` and `error.png`.
Both were opened and inspected: legible complete help, explicit fit/unit policy,
no clipping, and a concise actionable unit error with status 2. These disposable
screenshots are not committed. Root separately owns corpus-manifest QA; no corpus
fixture is introduced into tests or packages.

## Delivery ownership

The worker edits only the package command engine, image schema, original command
tests, two already registered safe-bash test files and this plan. Root owns the
SDK, research reconciliation, final maintained checks and atomic local commit.
No worker commit, push, release, README edit or pipeline execution occurs.
