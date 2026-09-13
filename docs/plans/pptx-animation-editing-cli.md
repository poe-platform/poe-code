# PPTX animation command integration

Scope: animation add/set/remove parsing, discovery, SDK export wiring and virtual
shell verification. Domain editing remains in packages/pptx; the existing
safe-bash adapter delegates to the command engine without new product I/O.

Contracts consulted: docs/specs/pptx.md section 6.6 and animation appendix,
docs/specs/office-cli.md and docs/specs/office-sdk.md. Research is recorded by the
separate animation evidence owner after reading the test/API audits and inventories.

## Original regression procedure

1. Run the command tests before implementation: all five initial cases fail
   because animation mutations are unsupported (2026-09-13).
2. Author all four effects with explicit triggers/targets. Parse output XML
   independently to verify unique timing IDs and existing target IDs. Set and
   remove through CLI. Check closed mutation result schemas.
3. Reject malformed times, triggers and missing required values before input
   admission. Reject a dependent first effect without publishing any output.
4. Check schema requirements and dry-run behavior with no output publication.
5. Run a virtual shell script using quoted paths and JSON targets from memfs;
   compare public SDK output bytes and independently check target references and
   empty diagnostics. Reject invalid edits without replacing bytes, then remove.
6. Execute the shared version-1 batch envelope through `--ops-json` and
   capability-scoped `--ops-file`, using closed `operation`, `arguments` and
   `options` records. Retarget a dependent trigger and then remove its predecessor
   with one publication. Unknown operations fail before document admission;
   later semantic failures publish nothing. Empty batches require no destination.
7. Verify batch dry-run, 1000-item schema bound, original-fingerprint selection
   normalization, per-effect counts and allowEmpty on a missing owning slide.

CLI Position values, including target.slide and batch option.slide, are one-based
integers. SDK MutateAnimationsOptions explicitly maps positions to
`{coordinateSystem:"one-based"|"zero-based",value}`. Targets remain whole shapes.
The SDK typed batch helper takes action/options operations; the command transport
accepts only the registered shared operation/arguments/options envelope. Both
use the same isolated editor and only the command adapter publishes.

## Verification receipts

- Initial red: 5/5 command cases fail unsupported-operation.
- Selected workspace build closure passes: `npm run build:workspaces -- --workspace=pptx`.
- Virtual shell case passes via `node --import tsx --test packages/safe-bash/tests/commands/pptx/animation-editing.test.ts`.
- Expanded CLI suite: 10/10 original cases pass, including ordered atomic batch.
- Expanded workspace build closure rerun passes after batch integration.
- Package lint initially reached test typechecking and exposed a concurrent root
  test's missing context argument; that owner fixed it. Root coordinates final
  maintained package checks and screenshot QA before committing.

No UI playback is claimed. No network fixture, native product runtime, README
edit, push, release or whole pipeline execution is part of this work.
