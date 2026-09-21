# Current ODS/SXC candidate verification

Task `ods-sxc-read`; execute this procedure as an agent. Preserve the existing
importer, integration, earlier QA and unrelated edits. No README edits, pushes
or publication. Root owns integration and Git; a separate agent owns independent
stress review and validated codec repairs.

1. Authenticate the already acquired official source archive under `out` against
   SHA-256 `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
   Audit stable OpenCalc handlers, using the earlier source audit as an index.
2. Add original in-memory regressions before repairs. Same-named style families
   must remain separate, including parent resolution and axis dimensions. Run
   the new cases to establish failures before editing the reader.
3. Ask a different agent to independently stress/fix the candidate. Require
   failing regression evidence for every repair. Keep native utilities outside
   unit tests, use memfs for filesystem tests, retain passive external links.
4. Run fresh maintained ssconvert workspace build, unit tests and lint. Run
   Safe Bash command integration and relevant dependency tests. Rerun gates
   after the independent agent's final repairs; earlier runs are provisional.
5. Use the existing unchanged 1.12.61 Linux oracle only through explicit Docker
   context `colima`; record its actual dependencies, plugin lists, locale,
   binary identity and source provenance. Give this invocation new HOME/XDG
   roots under `out/ods-sxc-current`. Do not modify or remove the shared oracle.
   Create original small packages in this owned directory, compare status,
   diagnostics and exported bytes against the actual JavaScript engine.
6. Verify CLI/SDK behavior and Gnumeric XML checkpoint/replay through memfs;
   include namespace negative controls, no external authority and failure
   cleanup. Inspect a screenshot of the actual virtual command output. Preserve
   fixture seeds and minimized cases in unit tests or this Markdown procedure.
7. Record exact candidate hashes, passes, failures, skips, unsupported and
   unmeasured runtime/profile cells separately. Never reuse historical pass
   counts as fresh evidence. Remove only owned temporary evidence after
   reducing findings. No native product dependency or fallback is authorized.

## Initial concrete failures

The original style-family regressions failed before implementation: a shared
sheet style lost hidden visibility; a paragraph style with a colliding name
caused `E Invalid OpenDocument: cyclic style inheritance` for a valid cell style.
Both now pass with family-qualified style lookup and inheritance.

## Compatibility scope

The existing [reader audit](ssconvert-ods-sxc-read-qa.md) remains the source-area
index and historical measurement record. XML retention is not semantic support.
Full validation/conditional-format execution, chart/drawing/image translation,
grouped filter execution, complete print/configuration application, malformed
scanner recovery and every optional dependency/plugin/locale variant remain
unsupported or unmeasured unless explicitly verified below.

## Final candidate results

Candidate identities and reproducible original package parts are in the
[captured QA profile](../ssconvert/ods-sxc-current-reference-profile.json).
The final importer SHA-256 is
`457ea623c1c0d68e2335e6b6aa8041e8040d21a015d07c43c896cf07024d03d6`.
This profile captures the existing Linux oracle's actual image, binary and
linked-library identities, dependency versions, build arguments, importer and
exporter observations, and explicit C/UTC environment. It is separate from
the frozen release reference profile and product runtime.

Verified passes:

- Fresh `npm run build:workspaces -- --workspace=@poe-code/ssconvert --no-cache`
  completed the maintained three-workspace dependency closure successfully.
- Fresh `npm run test --workspace=@poe-code/ssconvert`: 172 files, 4,458 tests
  passed; no skips or failures. The final independent repairs were included.
- Maintained `npm run lint --workspace=@poe-code/ssconvert` completed after
  independent repairs, including package ESLint and production/test TypeScript.
- `node --import tsx --test packages/safe-bash/tests/commands/ssconvert.test.ts
  packages/safe-bash/tests/commands/ssconvert-odf.test.ts`: 51 passed, zero
  failures/skips. This is focused command evidence, not the complete Bash gate.
- Scoped ESLint and strict ES2023 NodeNext TypeScript checks, additionally
  enabling unchecked-index and exact-optional checks, passed for the changed
  ODF integration file and its imported source closure.
- Fresh maintained `npm run test --workspace=@poe-code/office-package`: two
  files, 47 ZIP/compression dependency tests passed, zero failures/skips.
- The existing independent 26-case stress suite remains included in the final
  workspace unit gate. Seven new independent cases and two root regressions
  establish boolean lexical rules, malformed-clock date recovery, family
  separation, namespace negative controls, sparse repeats, budgets and abort
  identity. Repairs were made only after concrete failing evidence.
- CLI/SDK XML output equality, original/checkpoint/replay values and selected
  style metadata, ordered diagnostics, malformed-input status, preserved input,
  destination preservation on repeat-budget failure and passive drawing links
  with input-only VFS reads pass through memfs.
- Eight original native CSV cases matched exit status, CSV bytes and stderr
  bytes through both the SDK and actual virtual command: booleans, incomplete
  clocks, colliding style families, repeated cached formulas, attacker
  namespaces, repeated warning ordering, modern template MIME and legacy SXC.
- Native XML additionally confirmed hidden visibility, row 0 height 18 points,
  column 0 width 36 points and first-cell format `0.00` for the original
  colliding-family fixture. Complete native XML bytes were not equal-tested.
- The generic maintained screenshot route captured the actual virtual
  conversion. The first image had an unreadable long JavaScript invocation
  header; a second capture with `--no-header` was inspected and clearly showed
  `3,99` and `99,99` on separate lines. No poe-code visual flow changed, so this
  captures the virtual command rather than an unrelated poe-code CLI command.

Failures and investigated setup errors:

- Maintained Safe Bash `npm run typecheck --workspace=@poe-platform/safe-bash`
  failed with exit 2 before compiler/runtime phases. The checkout peer
  preflight in `tests/plugins/qualified-current-release/peer.mjs:245` requires
  `poe-code` export `./safe-fs` to import
  `./packages/safe-js/dist/safe-fs.js`; current root metadata has no such export.
  This route did not complete. Restoring that export would alter the existing
  SafeFS migration outside these codec repairs; no root/export changes were
  made and no focused result is substituted for this maintained gate.
- The first new integration test used a nonexistent `importWorkbook` SDK
  method and failed. It was corrected to the inspected public `readWorkbook`
  API; final original/checkpoint/replay assertions pass.
- An initial ad hoc TS source invocation omitted the required tsx loader and
  failed module resolution. It was rerun with `--import tsx` successfully.
- An initial ad hoc type check selected ES2022 and failed on existing `findLast`
  uses. Rerunning with the package's declared ES2023 target and strict flags
  succeeded. This was a check setup error, not a product-code repair.
- The Docker default context lacked a daemon socket. Explicit `colima` reached
  the existing oracle successfully; its container and shared source were left
  unchanged.

Measured mismatch:

- Requested `application/vnd.sun.xml.calc.template` imports as legacy Calc and
  produces `6\n` in product CLI and SDK. Released 1.12.61 rejects the original
  valid legacy fixture with status 1 and
  `E Unsupported file format for file "legacy-template.stc"\n`. Requested
  support remains a deliberate compatibility extension, not a native pass.

Unsupported/unverified/skipped/incomplete:

- No complete Gnumeric compatibility certificate: the source-audit limitations
  above and the earlier reader audit remain. Retained validation, conditional
  format, chart/image, grouped-filter and print/configuration XML does not mean
  executable or complete export support.
- Optional-plugin profiles, other dependency snapshots, non-C locales, browser,
  workerd and restricted SafeJS engine realms were not freshly qualified.
  Node 22.22.2 host execution is measured; namespace tests alone do not qualify
  runtime realms. All unavailable matrix cells remain unverified.
- No generated/fuzz cohort was run; the fixed minimized original cases are
  reproduced from unit fixtures and the profile's UTF-8 package parts.
- Unit timings are deterministic semantic-test observations, not bounded
  throughput, memory/RSS or performance measurements. No performance pass.
- Full repository `npm test`, repository-wide lint and root `npm run build`
  were not run for these isolated codec repairs and integration tests. No
  workflow changes or workflow tests, release builds or publication occurred.
- No local commits, remote-main delivery, pushes or releases. Existing
  untracked implementation work and all unrelated edits were preserved.

## Evidence reduction and cleanup

The profile retains original package parts, measured native/product tuples,
selected native XML metadata observations, installed plugin identities and
source/runtime identities. Plugin presence alone is explicitly not activation
evidence. Raw unit/integration/dependency logs were inspected before cleanup;
the screenshot was visually inspected. Only task-owned `out/ods-sxc-current`
scratch is removed after reduction. Earlier source archives, oracle source and
the shared `ssconvert-statistics-qa` container remain untouched.

Inspected evidence SHA-256 identities before removal:

- Workspace unit log:
  `3593239d07c96ba63e605b177143b8e609bf0298917027ea26c5214a7e897457`.
- Focused integration log:
  `aaed38c3e60beb88aee8139401a232af25c3f88c09a1376a8d6bd07798465b77`.
- ZIP dependency log:
  `77dddae6d9cbeaa299d114b0591ad60d69f9c588f834bfb7fb69135f1aff909c`.
- Inspected conversion screenshot:
  `7705543742b831ea48ca6c6b4e9df20026bb1a12d2d69ef9a06a25129a6ea6e5`.
