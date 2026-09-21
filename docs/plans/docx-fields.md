# Bounded cached-field task

Scope: simple and complex field inventory and selected cached-result edits only.
Later creation, instruction authoring, TOC/caption work, shared-story mutation,
live field owners and whole-public-API qualification are outside this task.

## Implementation and acceptance

- Retain the existing story-local begin/separate/end stack, nested field locations
  and split instruction accumulation. Inspection reports form, instruction keyword,
  exact decoded instruction, cached result, owner location, nested locations and
  stored update/lock state. Instructions are never executed.
- Retain selected MERGEFIELD/PAGE/NUMPAGES/REF/PAGEREF/SEQ/TOC cache editing and
  pre-edit rejection of malformed/unsupported selections. Replacing an outer
  result containing nested fields remains unsupported.
- Fix empty caches with an existing empty result run: insert into that run so
  its direct formatting applies to the displayed result. The parser remembers
  the first active, separated, properties-only run in the current field. It
  excludes instruction and boundary runs. When no such run exists, retain the
  existing insertion behavior.
- Preserve original tests. Add original memfs-backed regressions in both Strict
  and Transitional dialects for empty simple MERGEFIELD and split complex
  MERGEFIELD caches. Independently assert XML instruction/entity/quote spelling,
  flags, formatting and result placement rather than relying on field rereading.

The new simple regressions failed with three runs instead of two; the complex
regressions failed because text was inserted in the separator run instead of the
formatted empty cache run. These failures preceded the corresponding code edits.
The focused field suites and direct CLI parity tests pass all 70 cases after
the fix. The added CLI cases independently verify result placement, formatting,
instruction text and lock preservation for both forms using direct flags.

## Exact JavaScript and security mapping

`inspectDocumentFields(Uint8Array, options, ArchiveContext)` is always async and
returns readonly snapshot data, not live model owners. `editDocumentFields`
is always async and uses explicit publication capabilities. Decoded instructions
and cached text map to strings; serialized instructions retain their untouched
lexical XML. Stored dirty/fldLock values map to booleans in inspection; omission
of an edit preserves their lexical values. Explicit `update` changes dirty only;
this bounded utility exposes no lock setter. Ordinal CLI selectors are one-based;
opaque tokens retain fingerprint/staleness checks. Operation option names remain
camelCase, with matching kebab-case flags, common JSON envelopes and exit statuses.
Both CLI and SDK invoke the same field editor; no adapter or root logic changes
are needed for this correction.

No instruction execution, native build, ambient host I/O, product networking,
downloaded assets or derived implementation material is involved. Unsafe content,
shared story ambiguity and malformed boundaries fail before publication.

The API audit and schema-v2 inventory contain no field-specific public model
owner. This additive F22 utility task does not promote or exclude Document,
Part/XmlPart, inherited APIs, enums, helpers, collections, prose-only APIs or
public underscore-prefixed types. Their exact historical dispositions and
documentation-error resolutions remain unchanged. The shared SDK's neutral model
spellings remain authoritative. The spec/audit's existing cached-field link now
resolves to this scoped plan; later-task and whole-model claims remain pending.

## Maintained verification

- `npm test --workspace=docx`: final run passed 245 files / 5,133 tests.
- `npm run lint --workspace=docx`: passed ESLint and both TypeScript checks;
  one existing unused-variable warning in operation-types.test.ts, no errors.
- `npm run build:workspaces -- --workspace=docx`: passed the maintained selected
  workspace dependency closure (five builds).

No visual CLI output changes are made. Existing field command tests cover direct
list/set, schema/help discovery, shared JSON results, dry-run and binary stdout.
Commit only owned field source/tests and this plan on main after maintained
checks pass. Do not push or release.
