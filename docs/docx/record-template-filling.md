# Record template filling

The bounded utility exposes `applyDocumentTemplate(bytes, options, context)` and
`docx template apply INPUT --data-file PATH|--data-json JSON`. Both use the same
engine, validation and publication contract. No environment variables or host
filesystem/network authority are added.

An explicit Word content-control tag declares each exact binding key. A tagged
text control can contain a literal `{{tag}}` placeholder split across runs; it is
filled as that control's scalar display, with first affected run formatting.
Ordinary brace text outside tagged controls remains unchanged. Controls with
existing displays can also be filled; tags remain reusable after filling.
No template expression language, callbacks or arbitrary member access exists.

```json
{
  "values": [
    {"binding": "title", "value": "Coastal survey"},
    {"binding": "people", "value": [
      {"values": [{"binding": "name", "value": "Élodie"}]},
      {"values": [{"binding": "name", "value": "東京"}]}
    ]}
  ]
}
```

`people` must tag a native repeating-section control whose native item prototype
contains the tagged `name` control. Native complete unmerged table rows and block
sections are supported. Nested repeats require their own tags and record arrays.
An array at the top level requires exactly one tagged body repeat with no
singleton fields. A record may bind singleton fields and several explicit repeats.
Every record must exactly match its level's distinct declaration keys; duplicate,
missing, extra, conflicting and malformed values refuse before publication.
Compatible scalar declarations sharing a key are all filled; multiple repeat
owners sharing a key are ambiguous and reject. Prior nested item schemas are
validated before they can be discarded.

Strings fill text, choices and deterministic Gregorian date controls; booleans
fill checkboxes. Empty string and false retain their typed meaning. Record schemas
admit finite numeric values, but the supported unbound scalar controls have no
numeric declaration, so a number cannot implicitly coerce to text. Choice uses
its declared value and stored label; date uses a validated YYYY-MM-DD day. Binary
media values are not a record scalar; admitted existing inline PNG decorations
are cloned while preserving exact shared bytes.

At most four native repeat levels and 1,000 requested data items per region are
admitted, subject also to cumulative matches, insertedNodes, embeddedMediaBytes,
table, work, retained-byte and serialized-output ceilings. CLI `--limit` and SDK
`limit` can only lower trusted ceilings. An empty repeat retains one reusable
placeholder item, clears its scalar displays and recursively clears child repeats.
Required cells/paragraphs and unrelated decorations remain.

Control IDs, bookmark names/IDs and internal destinations, contained classic
comment markers/bodies, drawing IDs and occurrence-local relationships are
remapped per repetition. Shared original media and unrelated parts/relationships
remain. Nested references crossing item boundaries, affected locks/bindings,
review, modern comments, opaque structures, merge fragments and section changes
reject. Nested repeats must have admitted unlocked native repeat ancestors;
undeclared enclosing controls cannot become repeat owners implicitly.

All effects stay inside an invocation-local session. Final package admission and
semantic validation precede a single external publication. Dry-run performs the
same semantic expansion without publishing; errors leave inputs and existing
outputs unchanged. Stdout packages contain no JSON or progress bytes. Common
output/in-place/force/cancellation/exit contracts apply unchanged.

Only body templates are edited; other stories are preserved. The original
`controls repeat` command retains its single-level boundary policy. Ordered
utility template batches and live document-model owners remain pending.

Original memfs tests cover scalar/literal filling, multilingual and empty records,
rows/sections, four levels and fifth-level refusal, varied prior counts, exact
nested keys, false/date/choice behavior, classic-comment/bookmark/drawing and
relationship integrity, media preservation/budgets, limits, protected/crossing
boundaries, dry-run, cancellation and transport failure. Actual Shell tests cover
VFS `.sh`, explicit JSON files, quoting, binary input/output pipelines and failure
retention. These are utility/structural checks; no Word renderer, downloaded
corpus, native reference build or whole-public-API qualification is claimed.

Frozen maintained verification passed 151 DOCX files / 3,060 tests, DOCX source/
test lint and the selected build closure. Actual Shell/registration passed 18
cases; maintained runner checks passed 515. Public portable and built export
checks passed. The [owned evidence record](../plans/docx-record-template-filling.md)
retains original failing regressions, gate logs and terminal QA scope. These
checks do not promote later tasks or whole-format/model conformance.
