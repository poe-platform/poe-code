# Modern comment inventory evidence

Status: Bounded modern inventory implemented; verification receipt below.

## Contract and provenance

This bounded F50 work follows the [format specification](../specs/pptx.md),
[shared CLI contract](../specs/office-cli.md) and
[shared SDK contract](../specs/office-sdk.md). Operations remain `comments list`
and `comments get`; modern comments are not converted into editable legacy ones.
No reference implementation code, text, assets or fixtures are used in the new
product cases. Existing standalone legal notices remain intact.

The [case receipt](modern-comments-case-map.json) accounts for all keyword matches
in the pinned 2,700 parametrized unit cases, 973 expanded BDD cases and 2,407 public
API records. None directly models modern annotations. Four unit matches concern
core metadata creator/description; six API matches concern those metadata members
and shape classification enum symbols. These remain separate obligations, not
modern comment passes. The existing [legacy receipt](comments-case-map.json)
retains all 121 adjacent lifecycle rows. No public member is removed or hidden
because it is inherited, untested or underscore-prefixed.

The historical audit status is a checkpoint, not current package-wide status.
This receipt adds original format/security behavior without claiming whole-API
coverage. Documented metadata `comments` is a description string, not an annotation
collection; the old documented core-properties class path resolves to the current
part-backed property as already recorded in the API audit.

## Disposable corpus QA

The [QA procedure](../plans/pptx-modern-comments.md) inspected the 14 local files
listed in [the manifest](corpus-manifest.json), verifying all SHA-256 values before
reading ZIP members. Four contain `ppt/authors.xml` in the modern 2018/8 namespace:
the three SEWP training decks and the global-outlook deck. Their author rows carry
`id`, `name`, `initials`, `userId` and `providerId`. No other XML member in these
fixtures contains that namespace. Author-only modern parts are therefore a real
preservation case; absent comment threads do not imply absent review identities.

No corpus bytes or personal identity values are copied into product fixtures.
The corpus does not provide real modern thread/reaction/mention fidelity evidence.
Original schema-based cases supply the bounded acceptance checks; no rendering or
complete application interoperability claim follows from ZIP inspection.

## Schema boundary

Primary schema research pins MS-PPTX revision 25.0, August 20, 2024:
[document](https://officeprotocoldoc.z19.web.core.windows.net/files/MS-PPTX/%5BMS-PPTX%5D.pdf),
[section 5.14 schema](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-pptx/af0dc8d7-ee58-435b-80fb-72f2b351b689),
[section 5.17 reaction schema](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-pptx/2f7f5f35-9fbd-4210-bfb8-bf411b5d2dd5),
and [author part](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-pptx/4071f53f-9509-405f-a76b-594b865e177a).

The understood comment/author namespace is
`http://schemas.microsoft.com/office/powerpoint/2018/8/main`; relationships use
`http://schemas.microsoft.com/office/2018/10/relationships/comments` and
`http://schemas.microsoft.com/office/2018/10/relationships/authors`.
Reaction inventory uses `http://schemas.microsoft.com/office/powerpoint/2022/03/main`.
The reader records raw author IDs, user/provider identity and reply parent/thread
associations. A missing author remains unresolved rather than matched by name.

A semantic mention schema has not been established by these pinned sources.
Mention-shaped extension content remains opaque XML under its owning comment.
This retains data and association but does not claim typed mention ranges,
recipient resolution, notifications or a separate generalized person schema.
Unknown XML and relationship parts remain byte-preserved on permitted edits.

## JavaScript and security mappings

`readComments(input, options, context)` is always asynchronous and returns detached
readonly legacy-or-modern operation records. It is not a live model collection.
Legacy record fields retain their existing spellings. Modern records have
`format: "modern"`, `index: null`, stable string IDs, `threadId`, `parentId`, replies,
reaction instances, author identity and opaque XML. IDs are identities, never
numeric sequence indices or display-name matches. Replies remain nested on normal
listing and can be looked up by their ID or fingerprinted selector.

`readCommentAuthors(input, context)` is an asynchronous inventory of legacy and
modern author identities, including author tables without threads. The existing
`comments list/get` JSON data includes `authors` alongside `comments` when data is
non-null. A missing `comments get` still returns null. This is an operation-level
addition, not a renamed source object-model member or a second alias layer.

The input uses bytes or explicit capabilities and the existing admission budgets;
no path, clock, user, network or native runtime is inferred. Raw stored UTC strings
are inventory values, without timezone conversion or synthesized timestamps.
Unknown or missing identity associations are retained rather than repaired.
Modern mutation fails with `unsupported-edit`; mutation of signed/protected input
continues to fail through the shared protections. The CLI emits the common error
envelope and does not publish output on rejection.

Legacy comment import now rejects opaque attributes/children that would require
unsupported author identity remapping. The existing destination author identities
remain intact. Explicit legacy text edits can preserve modern comment/author parts
and their relationships; they never downgrade modern threads to legacy annotations.

The freshly built public `readCommentAuthors` SDK was then run against those four
hash-verified corpus inputs with the manifest's expanded QA limits. It returned
3, 2, 2 and 15 modern identities respectively. The global-outlook package also
returned 11 legacy authors (26 total), providing real modern/legacy author-table
coexistence evidence. This was read-only inspection, not a corpus mutation or
thread-rendering check; no identity values or fixture bytes were retained here.

## Maintained verification receipt

- `npm run test:unit --workspace=pptx`: 4,173 passes across 163 files; no failures
  or skips. This includes the new regressions, not an additional case count.
- `npm run lint --workspace=pptx`: passed package ESLint, production TypeScript
  and test TypeScript after the shared guard integration.
- `npm run build:workspaces -- --workspace=pptx`: passed all three declared
  dependency-closure builds.
- Public compiled SDK plus safe-bash comments suites: 8/8 passed.
- Maintained safe-bash runner checks: 499/499 passed, including exact test discovery.
- Actual comment help output captured and visually inspected; generic `--id ID`
  and modern read-only boundary are visible, complete and legible.

The first package-wide pass encountered two in-progress safety fixture defects
(ZIP version assertion and missing signature-origin content type). The original
fixtures were corrected; the final maintained run above passed all cases. No
product check was relaxed to hide those failures. The broader pipeline was not run.

The additional guarded root `npm run lint:eslint` run was **incomplete**, exit 2:
its subject cap stopped it after 12,000 linted files (12,001 configured), with
zero reported errors or warnings and no reported gaps. The stop was at
`packages/agent-eval/src/run/oracle.ts`, with failure message `subject cap`.
This is not a clean repository-wide lint pass. No guard limits, exclusions or
unrelated infrastructure were changed to bypass it. The maintained package lint
and focused adapter execution receipts above are separate, bounded evidence.

Final identity review added three more original SDK/CLI regressions: opaque
comment-list metadata, author-list metadata and an opaque reference on a sibling
comment. Actual author reassignment validates both complete legacy lists before
remapping; text-only edits continue to preserve opaque content. This avoids
claiming sibling references are irrelevant merely because their owner is not the
selected comment.
