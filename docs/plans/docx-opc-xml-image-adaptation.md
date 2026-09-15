# OPC, XML and image behavioral adaptation

Task: `adapt-upstream-opc-xml-images`. Status: in progress; later tasks pending.

## Ownership

Own `packages/docx/src/pack-uri.ts`, `pack-uri.test.ts`,
`pack-uri-batch-operations.ts`, `pack-uri-batch.test.ts`,
`style-model-batch-operations.ts`, `style-model-batch.ts`, the single static
receiver correction in `operation-schema-data.ts`, `style-model-result-schema.ts`,
and only the URI help/feature classification additions in `discovery.ts`,
`xml-sequence-cases.test.ts`, the single PackURI export addition in `index.ts`,
this plan, and `docs/docx/opc-xml-image-case-map.json`. Existing changes in
`index.ts`, all other modified/untracked files and the main pipeline plan are
outside this task's ownership. Stage the export addition independently.
No safe-bash implementation is needed for these changes; the substantive
safe-bash delegation rule is therefore not invoked. No README, push or release.

## Authority and scope

Read the format specification, shared CLI/SDK contracts, root instructions,
DOCX test/API audits and inventories and the crosslinked PPTX test audit.
The immutable source inventories remain historical evidence. The existing
crosswalk supplies 369 package/URI/content-type/serializer/XML/image rows:
231 package/archive/XML rows and 138 image rows. The supplement accounts for
all these identities separately from whole public API coverage.

The original reference suite is python-docx at
`e45454602b53e8e572b179ccf1c91093ec9f4ed7`; its retained source-expression
catalog supplies URI constants and XML sequence variants. Original wording,
part paths, namespace and child names replace incidental reference snippets.
The standalone existing legal notice remains required. No binary QA fixture
is read, copied, shipped or deleted in this increment.

## Executed TDD and QA

1. Capture branch, HEAD, worktree and index; preserve existing edits.
2. Write original memfs tests through the SDK export before product code.
   `npx vitest run packages/docx/src/pack-uri.test.ts` failed all 34 tests because
   PackURI was not exported/implemented. Implement the immutable value class.
   The same command passed 34 cases.
3. Add original empty-reference boundary tests. The command failed two of 36
   cases: nested empty reference returned the internal owner sentinel; root
   empty reference rejected. Correct the new constructor path. Both now pass.
4. Add 22 independent original memfs XML sequence observations: six selected
   first-child variants, five insertion variants and eleven removal variants.
   These passed against the existing editor without modifying editor code.
   Do not fabricate red evidence for already implemented behavior.
5. Write the typed batch and CLI parity tests before integration. Eleven of
   twelve tests fail on unsupported execution. Connect fixed schema IDs to the
   SDK class and encode immutable values as strings while retaining checked named
   receivers within the batch. A further independent test fails because the
   relative factory incorrectly requires an instance receiver. Correct the
   parsed schema entry to a static factory and test it without a receiver. The
   final thirteen batch/CLI/schema cases pass. A schema test first failed on
   document-handle serialization, then on text-formatting feature classification;
   correct URI results to strings and URI features to F01. The final focused
   discovery and URI/XML set passes 111 tests in seven files.
6. Run scoped maintained package unit/lint/build checks and the focused cases
   after the final URI correction. Record exact results in the evidence map.
7. Inspect explicitly staged ownership, commit each independently reviewable
   improvement, and verify commit contents. Keep all remaining rows pending.

These changes affect SDK values and test coverage, not CLI presentation. No
document rendering result is claimed. CLI batch help now names the additional immutable URI subset and checked
value semantics. Generate actual detailed URI help through the built command
engine, then execute `npm run screenshot-poe-code -- --no-header --output
/tmp/docx-uri-batch-qa/uri-help.png bash --root /tmp/docx-uri-batch-qa -c
'cat help.txt'` and inspect the PNG. The initial manual engine invocation
omitted its required options and failed before execution; repeat it with
explicit limits before generating the qualified transcript. No unit or product
I/O uses these disposable transcripts. Corpus/renderer QA and
full image characterization remain unrun for this increment.

## Language, security and drift decisions

PackURI is an immutable validated value with the neutral model spellings
`from_rel_ref`, `baseURI`, `ext`, `filename`, `idx`, `membername`, `relative_ref`
and `rels_uri`. Use `new PackURI(string)` in JavaScript; inherited string
behavior maps to explicit `toString()` and value JSON, with no String subclass,
implicit host path resolution or ambient I/O. Properties are synchronous;
package admission/publication remain asynchronous capability operations.

Root `/` is a package value, not an ordinary part target. Empty directory-relative
references retain the directory/package value. The relative constructor rejects
fragments rather than discarding them. Part URIs use the admitted engine's
normalization and escaping. Filename numbers are decimal trailing ASCII digits;
absence is null and zero remains zero. Unsafe numeric values reject on reading.
Readonly return values are primitives or immutable PackURI values; `idx` and
`rels_uri` are not live node handles despite the generic owner text in the
proposed API map. This is a scoped mapping clarification, not a promotion of
pending owner-based model or CLI batch APIs.

The ten URI members execute through existing fixed typed batch IDs
`model.opc.packuri.PackURI.*`; command JSON uses admitted string arguments and
named result handles. Constructor and relative factory do not require a receiver;
instance reads require a checked named PackURI value. Returned relationship URI
values remain usable as receivers without leaking internal storage or gaining
publication authority. Public batch JSON serializes them as strings. The existing
proposed schema incorrectly required an instance for the static relative factory;
its receiver is now null. Generic schema/capability discovery derives the added
implemented paths from the executor registry.

General Package/Part/XmlPart,
relationship collections, lifecycle hooks, inherited APIs, enums/helpers and
public underscore-prefixed types remain separately pending. No unsupported
member is excluded or renamed as private. Plural resources, `text replace`,
selectors, JSON and exit contracts remain authoritative.

## Completion gate

The nine URI and 22 XML sequence rows have passing original tests and
separately staged owned increments. All 338 remaining source rows retain pending
delivery dispositions and require exact observable tests and executed receipts. Existing broad tests do not automatically satisfy dedicated variant
accounting. The task must remain open until every selected row is reconciled to
a passing target, relevant API drift is resolved, and maintained checks pass.

## Verified local checks

Final maintained `npm test --workspace=docx`: 3,226 passes in 161 files,
zero failures/skips, 157.93 seconds. Final `npm run lint --workspace=docx`
passes source/test TypeScript and ESLint with zero errors and the existing
operation-types.test.ts warning. Final maintained DOCX workspace build closure
passes. Detailed built URI help screenshot was generated through the maintained
command and visually inspected; operation, receiver and required argument are
readable and present. Earlier broad runs observed active red tests and are not
final gates. No final test timeout or failure remains.

## Owned local delivery

`549d639ae` adds checked URI values with typed batch CLI/schema/discovery parity.
The next atomic test commit delivers the 22 original XML sequence variants and
their passing row reconciliations. Both use the final maintained checks above.
Task status remains in progress; later tasks remain pending. No push or release.
