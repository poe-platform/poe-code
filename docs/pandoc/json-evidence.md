# JSON implementation verification

Verified 2026-09-16. The initial original in-memory JSON suite reproduced the
missing codec: 93 of 94 tests failed with absent JSON capabilities. Implementation
then passed those JSON cases. Three older availability expectations reproduced
the registry change and were updated to include JSON. Additional original cases
verify span geometry, nested values, integer boundaries and cancellation. Final
suite: **206 tests passed across six files**, including **115 JSON tests**.

Maintained checks passed:

- `npm test --workspace=@poe-code/pandoc`
- `npm run lint --workspace=@poe-code/pandoc` (ESLint and source/test typecheck)
- `npm run build:workspaces -- --workspace=@poe-code/pandoc`

Focused package routes cover this codec, declaration-only registry binding,
public conversion coordination and existing thin inspection adapter. Shared
runtime infrastructure was not changed. Unit cases use only original in-memory
objects/bytes and mocks: no filesystem mutations (so no memfs was necessary),
LLMs, native executables, downloaded fixtures or host scratch files.

Pinned upstream consultation: pandoc-types **1.23.1.2** `Definition.hs`, including
the JSON instance options, every Block/Inline/MetaValue/Citation constructor,
modern Table/Caption/Row/Cell structures and Figure. Retrieval hash, source URL,
native binary release URL/archive hash and original artifact hashes are recorded
in [provenance.json](json-research/provenance.json). No upstream implementation or
fixture payload was imported into unit tests or the converter.

Native research used Pandoc **3.11**, which emitted `[1,23,1,2]`, on the original
[Markdown input](json-research/original.md). Actual
[native JSON](json-research/native-3.11.json) contains empty metadata maps/lists,
Unicode, citations, math, modern Figure/Table and raw block/inline nodes.
The built TypeScript reader/writer produced
[round-trip JSON](json-research/typescript-roundtrip.json) equal to that observed
native JSON. Native then reread it and emitted
[identical JSON](json-research/native-reread.json). Equality comparisons parsed
JSON and ignored object key order only; all list order, text, attributes, node
types and table shape were compared. No `.native` Haskell fixture was used.
An earlier research probe of Pandoc 3.6.4 emitted `[1,23,1]`; that is intentionally
outside this codec's exact-version contract. Downloaded executable/archive
research artifacts and temporary logs were removed after use.

Canonical expected JSON is independently authored in the unit cases, covering
all supported constructors and enum choices. It is never populated from native
output or codec output. Malformed nested tags, arity, attrs, Unicode, metadata,
citation integers, enum forms, table spans/sections and wrong API versions fail.
Duplicate JSON keys, including escaped equivalents, are diagnosed by a tokenizer
before JSON.parse could overwrite them. Reader failure prevents writer/output;
unknown writer constructors and unrepresentable document fields prevent output.

Visual QA used the maintained `npm run screenshot` route on the built SDK's
combined format listings, then inspected [the screenshot](json-formats.png).
JSON is shown under both input and output headings with readable spacing.
The poe-code CLI has no newly wired pandoc conversion command; the existing
opt-in adapter derives JSON availability automatically. Procedures are recorded
in [the owned plan](../plans/pandoc-json.md), and numeric/version limits are
explicit in [the JSON contract](json-contract.md).
