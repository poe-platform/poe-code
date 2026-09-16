# DOCX document locations

Implemented subset: revision-bound package-engine locations. This document records
`document-locations`; the proposed format and Office contracts remain additive.
The live object model, command registration, operation schemas/envelopes and
feature editors are later tasks. No full CLI, model or format conformance is claimed.

## Admission and identity

`openDocumentLocations(bytes, context)` always returns a Promise. It admits an
owned copy of the exact archive bytes under the existing explicit limits, signal
and optional invocation budget. SHA-256 is computed over that copy, including ZIP
metadata and opaque binary payloads. Neither text decoding, XML normalization nor
recompression supplies identity. Two different binary payloads that display as
the same replacement character still have different document fingerprints.

The returned `DocumentLocations` type has synchronous queries and staged edits.
Its construction implementation is not exported as a runtime factory accepting
an arbitrary caller-provided fingerprint. This is an original engine type, not a
reclassification of a documented model member as private.

`encodeLocation` and `decodeLocation` implement section 6.3's exact
`docx-loc-v1.` token: unpadded base64url, UTF-8 JSON, fixed key order, version 1,
64 lowercase SHA-256 digits, safe nonnegative generation, canonical absolute
part, story owner, zero-based element-child path, and nullable half-open scalar
range. All fields are required; duplicate/extra fields, noncanonical encodings,
sparse/accessor paths and inherited data fields reject with `usage`. Tokens are
bounded to 32,779 characters; decoded paths to 256 steps. Tokens are data and
stale-state guards, not authority or authentication credentials.

Paths count original XML element children, including compatibility wrappers;
comments, processing instructions and whitespace do not change child indexes.
Only active understood content contributes semantic locations. Namespace URI and
local name determine kind, never a chosen prefix. Reformatting or renaming a
prefix preserves logical addresses but changes the admitted archive fingerprint,
so old tokens still reject. No parser object is stored in a returned location.

## Typed locations and selection

`Location<K>` is a discriminated immutable value with `kind`, `token`, `value`
and readable `positions`. Named aliases cover part, story, paragraph, run, table,
cell, image and annotation locations. `resolve(token, kind?)` validates the
fingerprint, generation, owner, address and range against current staged state.
A comment body can be both a story and an annotation at one address; pass the
expected kind when resolving that resource. Those are two views of one owner,
not two independently mutable comment bodies.

`list(kind, {scope?, owner?})` defaults story-owned content to body; parts are
package-wide, including content types and relationships. Supported scopes are
`body`, `headers`, `footers`, `footnotes`, `endnotes`, `comments`, `text-boxes` and
`all-stories`. A scoped owner token cannot be combined with a separate scope.
`at(kind, position, query?)` uses positive one-based resource positions; run
ordinals require a paragraph owner. Invalid owner chains reject. These operation
positions do not change the future model collections' zero-based indexing.

Story order is body, section-ordered headers, footers, numeric-ID notes/comments,
then recursively ordered text boxes. Linked header/footer stories are visited
once while `references(token)` retains every section/variant binding, including
inherited bindings. IDs are scoped by owning part. Text-box children belong to
their own story rather than also appearing in their enclosing story's text.
Remaining package locations use canonical part-name order.

`cell(tableToken, "B2")` resolves uppercase one-based logical coordinates. Grid
spans and vertical continuations map to the same anchor token. Omitted grid
slots remain absent. Out-of-bounds coordinates fail; unsupported legacy
horizontal merges and unresolved vertical continuations do not guess an anchor.
Grid construction is bounded by the existing row/column/cell budgets. Merge/split
operations and rectangular selection semantics remain with the later table task.

`range(token, start, end)` creates a scalar-counted range on a paragraph or run.
The initial safe range subset is ordinary text, tabs and line breaks across
formatting runs, with hyperlink boundaries. Owners containing fields, tracked
changes, objects or other unsupported range content reject conservatively; the
later logical-text task supplies the richer view-specific maps. This layer does
not silently remove unsupported content from an offset calculation. Token ranges
that no longer resolve fail `stale-selection`; invalid newly requested coordinates
fail `usage` or `missing-selection` before any staging callback.

`select(candidates, options, mode)` shares `first`, `all`, `occurrence` and
`allowEmpty` spelling and validation. Text mode requires exactly one cardinality,
even for one match. Mutation mode rejects multiple targets unless cardinality is
explicit; read mode accepts an empty result. `allowEmpty` is mutation-only and
never suppresses ambiguity, stale tokens, invalid options or an out-of-range
occurrence. Identical tokens are deduplicated; repeated text at different ranges
or in different paragraphs remains distinct. Ambiguity errors carry bounded
candidate tokens, without document text in their messages.

## Staging and mutation receipts

`mutate(candidates, options, stage)` first validates all candidates, cardinality,
and explicit shared-part intent. Shared header/footer parts, including their
text-box descendants, require `shared: true`; there is no implicit cloning.
No targets with allowed empty intent means the callback is not invoked.

The synchronous callback is trusted engine code receiving a detached
`DocumentArchiveEditor` and resolved locations. It returns typed
`{before: token, after: address | null}` receipts for directly changed logical
objects. Feature engines must report their exact direct targets and dependent
changes; this is not a document-supplied callback, dynamic batch dispatcher,
second text editor, authorization system or host-JavaScript sandbox. Existing XML
editing primitives perform the actual edits and package validation.

Staging checks distinct selected receipt owners, actual changed package bytes and
fresh destination addresses before committing state. Unchanged documents cannot
report changes; changed documents require receipts. A surviving object cannot be
reported deleted; removal of a text range can retain its enclosing paragraph.
Failed edits, invalid receipts, cancellation or result limits
leave the session's archive, generation and previous locations intact. Receipts
may resize ranges after text edits; an old range is not blindly reattached.

Success returns `affected`, updated `locations` and `{before, after}` changes.
Generation increments once per changed operation; reads and zero-change edits do
not increment it. Every earlier-generation token becomes stale. Only updated
locations are current; before-locations remain historical evidence.
`snapshot()` returns owned staged archive bytes for the existing validation and
publication primitives. Published bytes get a new SHA-256 on fresh admission.

## Language, security and command mappings

This work adds original location-engine primitives, not model-method aliases.
The audit/inventory's documented inherited members, underscore-prefixed types,
collections, enum/helper APIs and public XML/package views remain in scope and
pending their own evidence. None of those records is promoted by these tests.
Read-only indexing does not invoke model getters that materialize linked stories.

JavaScript uses readonly objects/arrays, synchronous admitted queries, safe integer
indexes, Unicode scalar offsets, explicit null ranges and always-async byte
admission. Missing/undefined optional switches use false; null, coercions and
inherited/accessor intent reject. Errors use existing `usage`, `limit-exceeded`
and `cancelled` categories plus `SelectionError` with `stale-selection`,
`ambiguous-selection` or `missing-selection`. No ambient clock, filesystem,
identity or network is consulted.

The later shared operation engine/CLI must use these same types and checks for
`--select`, one-based selectors, `--first`, `--all`, `--occurrence`,
`--allow-empty` and explicit shared intent. It must retain plural resources,
`text replace`, common envelopes, schema/capabilities and exit mappings. This
bounded task adds no command path and therefore makes no CLI/SDK end-to-end or
schema coverage claim. The documented model's neutral method/property spellings
and source-specific language/security decisions are unchanged.

The proposed spec's opening historical statement that no engine has been verified
is not the status of this primitive: the owned execution record below identifies
its actual evidence without marking the whole proposed specification implemented.

## Evidence

See [the owned execution record](../plans/docx-document-locations.md) for red/green
results, maintained checks and the boundary with later tasks. All fixtures are
small, original, in memory; memfs handles test output mutations. There are no
downloads, native reference builds, copied binary fixtures or rendering claims.
The synthetic media bytes exercise opaque byte ownership, not image decoding.
