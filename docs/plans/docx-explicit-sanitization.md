# Selective DOCX sanitization

Bounded task: `explicit-sanitization` (F46). Later tasks remain pending under
this assignment. This record qualifies the existing utility and its shared
CLI/SDK engine; it does not claim whole-format or whole-model coverage.

## Enumerated actions

`sanitize --remove properties,comments,revisions,links,objects` accepts a
nonempty unique subset. Execution follows that fixed order regardless of caller
ordering. `revisionPolicy` / `--revision-policy` is required exactly when
revisions are selected, with `accept` or `reject`.

1. Properties: remove records classified editable by `properties.remove`;
   report their canonical property names. Cached, invalid, opaque and ambiguously
   owned values remain. Native creator storage maps to utility `core:author`
   and the neutral model `CoreProperties.author`; no creator alias is added.
2. Comments: invoke supported `comments.remove` for all comment IDs and owned
   markers, preserving anchored document text. The same extension synchronization
   rules apply. Unsupported affected review structures reject; empty comment
   parts and unrelated resources may remain.
3. Revisions: invoke `revisions.accept` or `revisions.reject` across all admitted
   stories. Supported insertion/deletion and verified run/paragraph formatting
   histories follow the existing decision profile. Moves, nested/structural or
   opaque affected histories reject. Report each decided location token.
4. Links: invoke `links.remove` for supported externally bound hyperlinks across
   all admitted stories, preserving label XML and retiring unused owner bindings.
   Internal anchors, field instructions and other external bindings remain.
5. Objects: remove only direct inert OLE carriers in admitted stories without
   previews or compound owners. Remove unused object bindings once per owner/ID,
   even when multiple carriers share them. Remove an unreferenced embedded leaf,
   its empty relationship sidecar and explicit content-type override together.
   Shared targets and unreferenced targets with outgoing graphs remain. Fields,
   permissions, revision ranges, controls and unsupported carriers reject.

Selected actions are preflighted against original bytes before staging. Existing
editors publish intermediate results only to private byte sinks. Final validated
publication uses the original baseline and existing destination/alias/stale-state
protections. Dry runs perform semantic staging without caller publication.
Failures preserve input and preexisting destination bytes. Binary stdout retains
its documented transport limitation once publication starts.

## JS/security mappings and retained gaps

The SDK `sanitizeDocument(Uint8Array, options, context)` always returns a Promise.
The common `sanitize` operation uses camelCase JSON options and corresponding
kebab-case flags, shared validation, status categories and result schemas. Byte
input is copied; filesystem/stdout capabilities, cancellation and cumulative
limits are explicit. No native process, ambient host access, network, callbacks
from document content or dynamic public-member invocation is introduced.

Action records are utility snapshots: property names, string comment IDs and
location tokens, not live model handles or Python collection/index semantics.
`affected` counts directly targeted logical records, not removed ZIP members or
relationships. The report separately lists removed parts/bindings, unselected
categories and retained gaps. Selecting every category does not remove inactive
or unknown markup, unrelated package data or every selected category's contents.
There is no comprehensive privacy or recoverability-removal guarantee.

The API audit and pinned inventory remain historical evidence. Document,
CoreProperties, Comment/Comments, Hyperlink, inherited Part/XmlPart and package
interfaces, collections, enums, helpers, prose-only members and publicly
documented underscore-prefixed types retain their separately recorded coverage
obligations. This additive utility does not hide or promote any such member.
The previously dangling audit link now resolves to this record.

## Verification

Original memfs regressions cover exact effects, retained values/labels/anchors,
classic markers, both revision policies, content-type and reference cleanup,
shared targets, protected regions, unsupported review structures, mixed semantic
and publication rollback, dry runs, schema and human/JSON CLI envelopes.

The new repeated-carrier regression failed before product changes in
`DocumentXmlEditor.replaceElement`: cleanup attempted to remove one binding
twice. Deduplicating owner/relationship pairs fixes that failure while preserving
two logical effects and one relationship removal. No downloaded fixture or
derived material is used.

`npm test --workspace=docx` passed: 247 files, 5,161 tests.
Scoped lint passed (zero errors; existing type-only-variable warning in
`operation-types.test.ts:20`). `npm run build:workspaces -- --workspace=docx`
passed its five-build declared dependency closure. The built command engine's
human dry-run report for two carriers sharing one binding was captured with
the maintained `npm run screenshot` tool and visually inspected: two records,
the precise object action, four unselected categories and explicit retention/
privacy gaps were visible and readable. The root `screenshot-poe-code` route
does not expose this virtual command. Disposable QA files are purged after use.
