# DOCX command schema mappings

Status: grammar/schema implementation; document-model execution remains pending.

This task preserves the historical research inventories. Its runtime registry has
113 direct command paths and 1,393 additional typed batch forms. Those are grammar
coverage counts, not implemented editing methods. The registry retains inherited
members, helpers, enum aliases, collections and documented underscore-prefixed
types. It does not infer privacy from a name.

## Evidence and scope

Authorities are `docs/specs/docx.md` sections 6.1–6.7,
`docs/specs/office-cli.md`, `docs/specs/office-sdk.md`, and the documentary
`docs/docx/command-coverage.json`, `public-api-map.json`,
`upstream-api-inventory.json`, and `upstream-api-audit.md`.

Effect corrections below were checked by reading the pinned python-docx source
at revision `e45454602b53e8e572b179ccf1c91093ec9f4ed7`, already available under
`/tmp/docx-upstream-review/src/docx`. No native reference build or reference
execution was used. These files remain disposable research evidence. Product
regressions use small original values and no source/downloaded fixtures.

Only operation IDs, field names, closed type declarations and enum symbols were
adapted into product declarations. Research paths, project identity, descriptions,
source comments, examples, assets and source code were not copied into product
files. The complete documentary history remains unchanged.

## Exact JavaScript and transport mappings

- Omitted optional fields and explicit optional `undefined` are absent. Required
  `undefined` rejects. Explicit `null` is accepted only in a nullable union.
  Empty text and `false` retain their distinct values; identifiers and paths must
  be nonempty. Unknown object keys, prototype keys, accessors, exotic data-object/array prototypes,
  sparse arrays, cyclic objects and invalid Unicode surrogate sequences reject.
- Finite numeric values are required; integer values must be safe integers.
  Lengths are `{value,unit}` with the explicit shared units. Ordinary direct
  length fields admit `emu/in/cm/mm/pt`; model lengths additionally admit `twip`.
  Target-specific positivity remains part of operation validation.
- Enum transport uses `{enum,name}` with the exact declared enum and symbol.
  Numeric enum input is rejected unless a specific conversion method declares a
  numeric overload. Generic `T` in enum conversion signatures is specialized to
  that operation's receiver enum. Neutral alias spellings are retained.
- SDK date values are valid plain `Date` objects; JSON uses valid UTC text ending
  in `Z`. Calendar-only values use a validated `YYYY-MM-DD` string. There is no
  local timezone or ambient-clock inference. Overridden date hooks reject.
- Owned `Uint8Array` values, including Node Buffer and byte subclasses, retain binary identity. Intrinsic byte admission/copying bypasses custom getters, iterators and constructors, and does not enumerate byte properties. JSON byte values use
  `{kind:"bytes",base64}` with canonical padded base64. Binary paths use
  `{kind:"vfs",path,capability}`. A model `Input` also accepts the documented
  `{path,capability}` VFS form. A capability ID names an already admitted host
  grant; its presence never creates authority or performs I/O.
- Serialized `DocumentContext` is closed: `vfs?` and `fonts?` are admitted
  capability IDs; `limits?` is a closed map of the documented limit names;
  `timestamp?` is UTC text; `author?` is text; `template?` is `BinaryInput`.
  Cancellation is supplied by the outer command context. JSON cannot introduce
  callbacks, a signal, a stream factory, network access, identity discovery or
  font discovery. Context-bearing model bodies and native stream adapters remain
  later work; schema coverage does not claim they execute.
- Model destination transport is `{path,capability}` for `VfsPath` or
  `{capability}` for a pre-admitted `ByteSink`. It does not accept a host callback.
  Publication controls remain on the enclosing invocation, with model output
  methods subject to the shared batch restrictions.
- Model values use closed owner/revision handles `{id,type,owner,revision}` or
  prior typed results `{resultHandle,index?}` / `{resultHandle,key?}`. Index and
  key are exclusive. The type is checked; actual owner existence and stale
  revisions are domain execution checks. Ordered relationship entries serialize
  as arrays of `[key,RelationshipViewHandle]`, never executable iterables.
- Equality operations whose declared input is `unknown` admit bounded safe data;
  this is not a permissive fallback for unknown type names. Functions, accessors,
  prototype keys and cycles still reject before dispatch.
- `XmlNodeInput` uses closed discriminators: `{kind:"text",text}`,
  `{kind:"comment",text}`, `{kind:"processingInstruction",target,data}`, or
  `{kind:"element",name,attributes?,children?}`. `name` is an `ExpandedName`;
  attributes are `{name:ExpandedName,value:string}` records; children recursively
  use `XmlNodeInput`. DTD/entity/callback nodes reject. XML names, lexical
  restrictions and package safety remain validated data, never code execution.
- Structured document content and template/control records reuse the one JSON
  validator, preserving rectangular tables, text/runs and style/level exclusivity,
  and unique binding identifiers. No dynamic property-based control binding exists.
- Installed JSON Schema discovery uses draft 2020-12 closed objects, precise
  scalar/enum types, recursive `$defs`, and closed operation discriminators.
  Semantic constraints such as rectangular grids, uniqueness by binding field,
  existing owner identity and revision freshness additionally require the runtime
  validators; they are not replaced by generic JSON Schema validation.

## Effect classification corrections

The historical map contains generic side-effect prose that is inaccurate for
some individual members. The runtime registry records explicit per-operation
mutation potential. It does not inspect method names during dispatch.

`Document.comments` can obtain a missing comments part: the pinned
`parts/document.py` `_comments_part` accessor creates and relates a new part when
absent. By contrast, these getters only read existing scalar/root state:

- `opc/coreprops.py` `CoreProperties.comments`: reads the existing comment text.
- `parts/comments.py` `CommentsPart.comments`: wraps the existing comments root.
- `parts/styles.py` `StylesPart.styles`: wraps its existing root.
- `parts/settings.py` `SettingsPart.settings`: wraps its existing settings root.
- `opc/parts/coreprops.py` `CorePropertiesPart.core_properties`: wraps its root.

Generic “may materialize” prose must not classify those existing-part views as
creating getters. Conversely, the following mutation evidence overrides generic
“no publication” prose:

- `text/run.py` `Run.mark_comment_range` inserts boundary/reference nodes.
- `text/tabstops.py` `TabStops.__delitem__` removes a tab; `clear_all` removes tabs.
- `opc/part.py` and `opc/package.py` `load_rel` add a relationship;
  `drop_rel` deletes one when eligible; `relate_to` can create one.
- `parts/story.py` `new_pic_inline` calls image admission/relationship creation.
- `parts/document.py` `drop_header_part` removes its relationship.
- `package.py` `ImageParts.append` changes the owned image collection.
- `opc/rel.py` `Relationships` is a dictionary-derived collection. Its mapped
  assignment/deletion/update/pop/popitem/setdefault operations mutate collection
  membership; keys/values/items/copy do not mutate it. Host-language internals are
  mapped to explicit typed operations rather than invoked dynamically.
- Original `mapped.XmlElementView` rows explicitly require attribute mutation,
  validated insertion and guarded removal. Their runtime forms are mutating;
  serialization remains a read.

A new detached value is not evidence that an existing document changed. The
registry's `mutates` flag denotes whether staged document publication may be
needed; the future executor must report actual changes and increment generation
only when a change occurred. No schema-only operation claims a completed edit.

## Original regressions and checks

`packages/docx/src/operation-schema.test.ts` began with an import failure before
implementation. Subsequent enum-alias, sparse-array, sanitization, generic-enum,
immutable-schema, effect-classification, serialized-value and exotic-object cases
were observed failing before their code changes. It checks original Unicode text,
closed fields, explicit null/empty/absent values, canonical binary input and model
handles without filesystem mutations.

`packages/docx/src/operation-json-schema.test.ts` also began with an import failure.
The batch-schema case first failed before its implementation. It checks closed
required arguments, enum and nullable schemas, recursive original content and
closed batch discriminators excluding recursive batch/discovery operations.

Focused regression runs and both package TypeScript configurations pass at the
schema milestone. The parent task runs the final maintained package checks after
integration. No commit, push or release is performed by this schema subtask.

## Typed operation exports and final schema checkpoint

`DocxOperationArguments<Id>` and `DocxOperationArgumentMap` preserve every declared
SDK field, its requiredness, nullability, enum symbols and explicit optional
`undefined`. `DocxValidatedOperation` is an operation-discriminated options union.
`DocxBatchArgumentMap` separately uses exact batch fields; `DocxBatchItemMap` and
`DocxBatchItem` require each applicable receiver type and only expose result
handles for declared value-producing forms. Empty model argument records reject
extra fields. The model execution methods remain pending.

The type checks first failed under the maintained TypeScript test configuration
for the missing type module, then for forbidden nested publication, missing
receivers and extra no-argument getter fields. They now compile with those invalid
examples explicitly rejected. Value/schema/type focused tests pass: 24 cases.
The schema discovery tests also require every declared field type to resolve,
which exposed and corrected literal-union ambiguity for property type tokens.
All eight story scopes are independently checked against original input values.

`schema` and `capabilities` are declared discovery paths; their availability is
separate from host-supplied domain dispatch. A declared operation does not claim
its document-model body executes. The command host remains responsible for
capability injection and supported operation registration, and later document
editing tasks remain pending.
