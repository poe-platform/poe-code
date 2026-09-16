# DOCX document-locations execution record

Status: implemented and verified.

Scope: only `document-locations` in the ordered DOCX pipeline. Later tasks,
starting with `sdk-live-object-model`, remain pending. Work is on main; no push
or release is authorized. The preexisting edits to the main pipeline and the
archived-plan move remain untouched and unstaged. This is the owned plan update.

## Owned files

- `packages/docx/src/location-token.ts`
- `packages/docx/src/location-index.ts`
- `packages/docx/src/locations.ts`
- `packages/docx/src/locations.test.ts`
- Location exports in `packages/docx/src/index.ts`
- `docs/docx/document-locations.md` and this execution record

Root only needs existing export wiring; no root or safe-bash changes are made.
The current adapter has I/O primitives only. Command construction, full operation
schemas/envelopes, model APIs and feature editors remain later tasks. This task
supplies one shared engine foundation, not an independent CLI editor.

## Contract and inventory review

Read root AGENTS.md, the safe-bash scoped instructions for boundary awareness,
DOCX and both shared Office specs, the public API audit, the parsed 920-record
API inventory and its relevant inherited owner/XML and cell/story members, plus
the existing reconciliation. No additional scoped instructions apply to docx.
The inventory's 23 documentation decisions and complete public-model obligations
remain intact; no underscore-prefixed type or untested API was removed or
marked implemented. Neutral model names stay unchanged.

The location implementation uses section 6.3's exact ordered token payload.
SHA-256 covers the exact admitted archive; namespace-prefix/formatting stability
applies to logical addresses, not byte identity. Typed ranges use Unicode scalars,
not UTF-16 code units. Source admission is async; admitted queries and trusted
engine staging are synchronous. Readonly values replace parser identity in
locations. Explicit capabilities remain required for I/O; no host time, identity,
network or filesystem is discovered. The implementation guide records exact
language/error mappings and the conservative plain-range subset.

The format spec remains Proposed. Its opening no-engine-verification statement
is historical and superseded for this primitive by this record; it is not used
to erase the completed package primitives or to claim full implementation.
No research record is promoted to whole-model or CLI parity from location tests.

## Failing tests before implementation

1. The first targeted maintained run had 16 failures: location exports did not
   exist. All 439 original tests were filtered, not counted as passes.
2. The first implementation exposed an original fixture mismatch: an image edge
   pointed to a part declared application/octet-stream. The fixture now declares
   its synthetic media payload as image data; it does not claim decoder coverage.
   All 16 initial cases passed after that fixture correction.
3. Seven focused cases produced four failures: content types missing from part
   inventory; unsafe field-relative ranges; absent run-owner validation; and
   shared header edits permitted without explicit shared intent. Corrections
   preserved prior tests and added section/variant reference receipts.
4. Five traversal/data cases produced two failures: inherited/accessor-backed
   payload data was accepted, and a surviving object could be reported deleted.
   Original notes/comments, MCE active paths, vertical spans and omitted-cell
   cases passed. The corrections passed the full 466-test package suite.
5. Four final scope cases reproduced inherited-switch classification and
   breadth-first nested text-box order. After fixing traversal, rerunning the
   nested case independently exposed the shared-header text-box guard omission.
   The guard now follows the owning part. Resized ranges and Strict namespace
   behavior passed through the original fixtures.
6. The final receipt review reproduced rejection of a genuinely removed text range
   because its paragraph survived. A new failing regression distinguishes range
   deletion from structural-object deletion. Only the latter requires the owning
   object itself to disappear.

Tests preserve all original names and cases. They cover shared parts, repeated
text/ranges, exact binary identity despite identical lossy display, edited
revisions, detached input/output bytes, stale/ambiguous/missing selection,
malformed tokens, bounds, cancellation and result budgets. Mutations use memfs
fixtures and the existing XML/package editor. No downloaded data or native
reference runtime was used.

## Maintained checks before the final range-receipt correction

- `npm test --workspace=docx`: exit 0; 470 tests passed across 15 files, no skips
  (439 retained original tests plus 31 location regressions).
- `npm run lint --workspace=docx`: exit 0; ESLint, source TypeScript and test
  TypeScript checks all passed after the final fixes.
- `npm run build:workspaces -- --workspace=docx`: exit 0; maintained three-package
  closure built office-package, safe-fs and docx without replacing the orchestrator.
- `git diff --check`: exit 0. Owned staged paths are checked again before commit.

After the range-receipt correction, all maintained checks were repeated:

- `npm test --workspace=docx`: exit 0; **471 passed across 15 files**, no skips
  (439 original cases and 32 new original location regressions).
- `npm run lint --workspace=docx`: exit 0; ESLint and both TypeScript checks.
- `npm run build:workspaces -- --workspace=docx`: exit 0; same maintained
  office-package/safe-fs/docx dependency closure.
- `git diff --check`: exit 0. The final owned staged diff also passed this check.

All checks completed before the local commit. Earlier filtered runs are
failing-test evidence, not claims that the skipped baseline passed.

No public CLI presentation changed, so no screenshot/renderer QA is applicable
or claimed. No README edits, unrelated staging, ignored artifacts, hook bypass,
co-author, push or release.
