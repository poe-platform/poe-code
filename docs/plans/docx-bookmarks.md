# Bounded bookmark ranges

Scope: F21 bookmark utility inspection, creation, rename and removal only.
Later field, model and other task work remains pending.

## Implementation and acceptance

The existing original engine provides `bookmarks.list`, `bookmarks.add`,
`bookmarks.set` and `bookmarks.remove`; the CLI invokes the same public SDK
functions. Keep those operation names, selectors and tests. Names are unique
document-wide, 1–40 ASCII letters/digits/underscores, starting with a letter or
underscore. IDs are checked nonnegative safe integers, normalized for collision
checks and allocated without reuse of existing IDs. Inspection reports malformed
boundaries, duplicate names/IDs, absent/reversed endpoints, overlaps and crossings
without emitting usable locations for an unsafe structure.

Creation uses a fingerprinted nonempty Unicode scalar paragraph range and
preserves styled multi-run content and table-cell ownership. Rename/removal can
also target an existing multi-paragraph range within one admitted container.
Stale locations, shared stories and unsafe boundaries reject. Removal retains
the range's content and annotations.

Rename requires `references: "update" | "reject"`. Removal requires
`references: "remove" | "reject"`. Only internal hyperlink anchors and literal
REF/PAGEREF operands in simple or admitted complex fields can be updated.
Explicit removal unwraps supported internal links/simple fields while preserving
cached content. Complex-field removal, opaque dependencies and unsafe instruction
structures reject. External links and unrelated fields remain unchanged.

The 2026-09-21 safety regression exposed dependent hyperlinks/simple/complex
fields inside tracked or controlled content being changed successfully.
Six reference tests and two CLI tests failed before implementation. Traversal now
retains tracked/control ancestry and complex-instruction boundary state, rejecting
dependent edits before applying any staged changes. An operand split across a
control boundary is also rejected. Original table-contained multi-run data
verifies matching CLI/SDK failure behavior; unrelated controlled fields stay
byte-for-byte unchanged. Test mutations use memfs; no downloaded fixtures,
reference runtime, ambient product I/O or networking is involved.

## Exact JavaScript and security mappings

| Contract | Mapping and limits |
| --- | --- |
| Inspection | `inspectDocumentBookmarks(bytes: Uint8Array, options, context): Promise<BookmarkListData>` is async, noncreating and returns snapshots, never live model members. |
| Editing | `editDocumentBookmarks(bytes: Uint8Array, request: BookmarkEditRequest, context): Promise<BookmarkEditData>` shares validated operation options and publication with the CLI. |
| CLI/SDK options | Plural `bookmarks` resource; CLI kebab-case maps to camelCase options (`dryRun`, `inPlace`, `allowEmpty`); one-based scoped selectors remain distinct from model collections. |
| Locations | Opaque fingerprinted tokens require the acquired document; stale tokens map to `stale-selection`/exit 1. Ranges use Unicode scalar offsets, not UTF-16 offsets. |
| Names/IDs | Names remain explicit strings; normalized stored decimal IDs are returned as strings, not collection positions. Invalid/duplicate/unsafe structures reject mutation. |
| References | Typed literal policy enum is required, with no inferred default. Field operands are parsed and never evaluated. Unsupported dependent behavior maps to `UnsupportedEditError`, code `unsupported-edit`, CLI exit 1. |
| Publication | Supplied byte sinks/VFS capabilities only; dry-run validates without publication. JSON uses the shared version-1 envelope with zero affected objects and null data on prepublication errors. |
| Resource/security authority | Supplied cancellation and cumulative budgets; no host identity, clock, files, native processes, field execution or network authority is inferred. |

## Inventory and documentation drift

Read `docs/specs/docx.md`, `office-cli.md`, `office-sdk.md`,
`docs/docx/upstream-api-audit.md` and the pinned 920-object API inventory.
The pin has no dedicated public bookmark owner; this utility is additive F21.
Related `Hyperlink.address`, `.fragment`, `.url`, `.text`, `.runs`,
`.contains_page_break`, inherited `.part` and `Paragraph.iter_inner_content`
retain their neutral spellings and separate model obligations. Public story,
table and underscore-prefixed owners, inherited interfaces, enum aliases,
collections, helpers and APIs without source tests remain in scope of their
existing inventory/overlays. Passing utility regressions neither promotes nor
hides those entries and makes no whole-public-API claim.

The spec and audit already linked this missing plan. This record restores that
bounded mapping without rewriting historical evidence. Document-wide malformed
inventory deliberately has no usable items; numeric selectors are positions,
not IDs; hidden underscore names use the same legal target grammar. Tracked or
controlled dependencies now explicitly reject, resolving the unsafe-reference
drift while retaining supported literal updates. Existing documentation-error
dispositions and later tasks remain unchanged.

## Verification

- Red: reference suite, six failures; CLI bookmark suite, two failures.
- Green: 61 bookmark/reference/CLI tests after implementation.
- `npm run test --workspace=docx -- --retry=1`: all 245 files and 5,124 tests
  passed. Four unrelated tests required one retry following simultaneous
  roughly 140-second and 105-second pauses. This is a completed gate with
  retries, not a clean first-attempt pass.
- The initial ordinary package run completed with two 5-second test timeouts
  (opaque metadata inspection and hyperlink input rejection). A one-worker
  rerun passed both but timed out in image/table cases and was interrupted
  before completion; it is not counted as a passed gate. The isolated hyperlink
  suite also passed all 40 tests. No test timeout limits were raised.
- `npm run lint --workspace=docx`: passed ESLint and both TypeScript checks;
  one existing unused-variable warning remains in `operation-types.test.ts`.
- `npm run build:workspaces -- --workspace=docx`: passed the maintained selected
  dependency closure, including the DOCX build and portable filesystem route.

Manual CLI QA procedure, executed against the original in-memory fixture:

1. Construct a `Survey` bookmark over original coastal-survey text and a
   controlled simple `REF Survey` field using the memfs-backed fixture builder.
2. Invoke the public command engine with `bookmarks set`, bookmark selector 1,
   `--name FinalSurvey --references update --dry-run`, supplying only explicit
   in-memory document reads and output sinks.
3. Capture the command's human output with the repository screenshot tool and
   inspect the image. Verify `unsupported-edit`, exit 1, readable layout and no
   document content in the failure diagnostic.
4. Remove the generated screenshot after inspection. It is disposable QA
   evidence, not a committed fixture or screenshot test.

The image was inspected successfully. `/out` is unavailable at the macOS
filesystem root; disposable evidence used the ignored workspace `out` directory.

No push or release is authorized for this task. Stage only owned source/tests,
this plan and the related specification clarification for one atomic safety fix.

## Follow-up verification: table-cell field boundaries

Inspection of the original engine exposed a complex `REF` instruction beginning
in one table cell and ending in another being accepted during rename. Original
memfs SDK and CLI regressions reproduced this before the correction: the SDK
published a rename instead of rejecting, and CLI dry-run returned exit 0 instead
of 1. The `reject` policy control already passed. The first SDK probe lacked
explicit archive encoding and reached a usage error; that probe is not the
behavioral red evidence. Supplying the original fixture encoding reproduced the
actual successful unsafe publication.

Prior red/green evidence was inspected in the committed plan and the
`62d76ffc2` source/test diff. No raw bookmark logs or images remain in the
disposable evidence directory; the historical failure counts are recorded
evidence, not a newly replayed historical red run. Current original suites
independently reverified the green behavior.

Reference traversal now isolates table cells using the existing container stack.
Incomplete/cross-cell fields reject before applying staged reference changes or
publishing bytes. Supported table-contained split instructions and original
multi-run ranges retain their existing tests. No API, operation name, reference
policy, public model spelling or capability authority changes.

The existing exact JS/security mappings apply unchanged. Re-reading the pinned
920-object inventory confirms no dedicated bookmark public owner. Related
Hyperlink and Paragraph, inherited members, enums, collections, helpers and
public underscore-prefixed types keep their historical dispositions and later
overlays; these utility tests do not establish whole-public-API coverage.

Executed checks:

- Original bookmark/reference/command suites: 64 tests passed, including both
  new red cases and the already-passing rejection-policy control.
- Maintained DOCX lint: ESLint and both TypeScript checks passed, with the
  existing `operation-types.test.ts` unused-variable warning.
- Maintained selected DOCX workspace build closure passed.
- Ordinary maintained DOCX package run: 244 files/5,126 tests passed and one
  5-second timeout in `control-bindings.test.ts` (unsupported descendant selector).
  The isolated original suite then passed all 34 tests without retries. This
  does not turn the failed package invocation into a passed gate; no timeout
  limit or unrelated implementation was changed.
- `npm run test --workspace=docx -- --retry=1`: completed successfully,
  all 245 files and 5,127 tests passed. This is a successful retry-enabled
  verification after the failed ordinary invocation, not a claim that the
  initial package gate passed.
- Original safe-bash bookmark VFS script/stdin/binary-pipe test: 1 passed via
  the Node/tsx runner on its exact maintained file. The package runner with a
  name pattern still loaded 1,269 files and was stopped; that broader attempt
  is not a completed gate.

Manual CLI QA procedure executed with the original in-memory fixture:

1. Build a two-cell table with a multi-run `Survey` bookmark and a
   `REF Survey` field whose begin/instruction and separator/end occupy separate
   cells; supply document reads only from memfs.
2. Invoke the public command engine for `bookmarks set --bookmark 1 --name
   FinalSurvey --references update --dry-run` with explicit byte sinks.
3. Capture and inspect actual human output using the repository screenshot
   command. The image showed a readable `unsupported-edit` diagnostic and
   exit 1 without document text. Remove the disposable image after inspection.

No downloads, native reference build, product host I/O or product networking
were used. Renderer/download corpus QA and full object-model conformance are
not claimed. Historical evidence above remains unchanged.
