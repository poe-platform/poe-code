# Selective DOCX sanitization

Scope: only the `explicit-sanitization` task. Later pipeline tasks remain pending.
Implementation and validation date: 2026-09-15.

Read the root guidance, the applicable safe-bash guidance, DOCX F46 and publication
contracts, shared office CLI/SDK contracts, public API audit and pinned inventory.
No reference runtime, download, native reference build or network request is used.
Original unit fixtures mutate memfs; package admission and editing use explicit
capabilities. Unrelated working-tree changes and historical evidence are preserved.

## Enumerated actions

`docx sanitize INPUT --remove properties,comments,revisions,links,objects` accepts
only a nonempty unique list of these categories, in any input order. Execution
order is properties, comments, revisions, links, objects. `revisionPolicy`
(`--revision-policy accept|reject`) is required exactly when revisions is selected.
Publication requires output or in-place, except dry-run. No implicit scrub-all.

1. Properties: remove supported writable core, extended and custom scalar records
   through `properties.remove`, using their exact qualified utility names.
   Cached, invalid, opaque, orphaned and ambiguously owned metadata is retained;
   the report identifies this gap. Empty metadata parts and bindings survive.
2. Comments: use `comments.remove --all` to remove supported classic bodies and
   owned range/reference markers, including the existing verified extension
   synchronization. Unsupported affected review/thread metadata rejects.
   Empty parts and unrelated resources can remain.
3. Revisions: explicitly accept or reject supported text/property revisions across
   admitted stories through existing decision operations. Nested/opaque/move/
   structural decisions reject the transaction. No live model or full review
   coverage is introduced.
4. Links: remove supported external hyperlink owners through `links.remove`,
   preserving visible label XML and formatting. Shared relationship IDs survive
   until the last physical owner reference disappears. Internal anchors, external
   fields, linked images and other external relationship roles are retained.
5. Objects: remove a native object inside a run containing one empty OLE declaration,
   with explicitly admitted relationship ID and standard inert attributes. No
   preview, child content, compound/control/review owner or unbound payload is
   admitted. Existing XML/archive editing and publication validation prepare
   the candidate. Only unused native object bindings and unreferenced leaf targets
   are collected; shared targets and targets with outgoing graphs remain.
   Owned empty relationship sidecars are removed with collected leaves; content
   types and member deletion are validated together.
   Field/permission/revision boundaries reject affected removal.

All requested operations preflight against the owned original. Subsequent edits
operate on privately staged bytes with no caller filesystem or stdout authority.
Tokens are refreshed after each owner edit. Candidate validation and synchronous
effect admission precede the single caller publication. A failure preserves input
and any existing destination; binary transport keeps its established post-start
rollback limitation. Signed/protected packages fail closed.

## Exact JS/security mappings and documentation drift

| Surface | Mapping and remaining obligation |
| --- | --- |
| Utility | Async `sanitizeDocument(bytes, options, context)` and direct `sanitize`; camelCase option fields, existing common JSON envelope/exit codes, explicit capability I/O, supplied limits/cancellation, no host identity/time/network |
| Effects | `actions` enumerates category, exact action token, affected count and records; property names and comment IDs are scalar strings, revisions/links/objects use owner tokens from their action's staged input |
| Publication | `dryRun`, `output`, SHA-256 receipt; synchronous `admitSanitization` sees a frozen conservative prospective receipt and must return undefined; callbacks cannot defer publication admission |
| Retention | Unselected `retained` categories, explicit `gaps`, exact `removedParts` and owner/ID `removedRelationships`; inactive/unknown markup and unrelated payloads remain; no comprehensive privacy or recoverability removal |
| Properties | Native `dc:creator` maps to utility `core:author`, preserving the documented neutral model `CoreProperties.author`; the original test's creator expectation was corrected, not added as a new alias |
| Model | Document/CoreProperties, Comment/Comments, Hyperlink and inherited Part/XmlPart/package APIs retain pinned obligations and spelling; public underscore-prefixed types, enums, collections, helpers and untested APIs remain separately accounted for |
| Review values | Utility comment IDs and nullable stored revision IDs/timestamps remain snapshots; no Date-valued live owner, current-time authoring, wrapper identity or comprehensive public model coverage is claimed |
| Batch | Declared sanitize batch grammar remains proposed; generic utility batches are still unsupported. Discovery advertises the direct bounded edit subset only |

The [API audit](../docx/upstream-api-audit.md) and
[inventory](../docx/upstream-api-inventory.json) remain historical evidence.
No inventory row is promoted merely by this utility milestone. The generic
proposed MutationData label is refined by the operation's enumerated published
schema and [bounded evidence](../docx/sanitization.md).

## Failing evidence and validation

- Before implementation, original sanitize tests failed on the absent module.
- Before command wiring, common-envelope and discovery tests failed specifically
  with unsupported-profile and an absent sanitize schema.
- Additional regressions failed on absent record enumeration, asynchronous effect
  admission, object removal inside fields/permission ranges, and non-atomic
  content-type/target candidate construction before their corresponding fixes.
- Initial package run: 146 files / 2,990 tests, three existing exact discovery
  expectations failed after adding the new command/capability. Their names and
  original coverage are retained with additive expected sanitize/F46 entries.
- Initial build/type checks rejected an ES2023 array method; the implementation
  now uses the package's ES2022 traversal contract.

Final maintained checks and visual QA results are recorded after execution below.

- Subsequent original regressions also reproduced the orphan embedding-folder
  relationship-part inventory defect and its owned empty-sidecar cleanup case.
  The independently verified [inventory prerequisite](docx-embedded-relationship-inventory.md)
  receives a separate atomic commit.
- SDK non-byte input originally coerced to an empty archive; an original failing
  test now qualifies explicit InputTypeError/usage refusal before input copying.
- Preserved follow-up package-run evidence: 146 files / 2,994 tests, two discovery
  ordering expectations and the newly added singular-effect assertion failed
  before their corrections. The next run passed 146 files / 2,996 tests.
- Final focused source/public-export checks: 63 tests passed, including the
  non-byte SDK regression added after that package run.
- Maintained `npm run lint --workspace=docx` passed ESLint and both source/test
  TypeScript projects. The unchanged existing type-only unused-variable warning
  in `operation-types.test.ts` remains; no lint finding was suppressed.
- Maintained `npm run build:workspaces -- --workspace=docx` passed the five-stage
  declared dependency closure, including portable dependencies and design export
  smoke checks. Built `poe-code/docx` self-import exposes `sanitizeDocument`.
- Existing actual Shell adapter/registration checks: 151 passed, zero skipped.
- Actual Shell visual QA: help and supported human dry-run exit 0; incompatible
  policy exit 2. Inspected all initial screenshots, then shortened overly wide
  help and corrected singular effects. Final help/effect screenshots inspected;
  all original QA artifacts retained under the disposable untracked output folder.

The final package run includes the last SDK type-regression addition; its result
is appended before owned commits. No push or release is requested or performed.

Final maintained `npm test --workspace=docx`: 146 files / 2,997 tests passed on
the final source/test state. All 21 additive/new cases and every original test
remain included. Only owned paths are committed; disposable QA inputs/screenshots
and unrelated plans/evidence remain outside these commits.

## Manual visual QA procedure

Execute actual Shell dispatch with the injected DOCX engine and an explicit
in-memory filesystem. Inspect generated sanitize help, a supported revision
dry-run report and an invalid revision-policy error. Render their terminal
transcripts to disposable PNGs under `output/docx-sanitization-qa`, then inspect
the screenshots. Do not create screenshot tests, commit fixtures or use a native
document runtime. Verify binary output separately through the original unit
package/link assertions and command adapter checks.
