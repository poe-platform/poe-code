# Bounded namespace-aware DOCX XML reading

Task: `namespace-xml-read`, 2026-09-14. Only reading is implemented here.
Serialization, MCE, dialect editing, live SDK views, commands and later pipeline
tasks remain pending. The pre-existing pipeline edits and plan move are untouched;
this standalone receipt is the owned plan update.

## Implementation and lossless policy

The engine's `parseDocumentXml(input: Uint8Array, options?: DocumentXmlLimits)`
returns `{ bytes, encoding, bom, root }` synchronously. This is an in-memory codec,
not the future async Document factory, XML-part operation or live model view.
The returned bytes are an owned copy, sufficient to retain an untouched XML part
exactly, including lexical quotes, reference spellings, whitespace and BOM.
The decoded tree preserves semantic values and order, not identical serialization.
No writer or edit acceptance claim is made by this task.

The existing safe-fs parser is reused through a dedicated `./xml` export with no
filesystem/native import closure. Its minimal extension retains document-level
prolog/epilog nodes, counts scalar text, enforces declaration case, matches generic
UTF-16 declarations to byte order, and rejects references outside the root.
DOCX package and main-part inspection now use this same parser; its previous
separate SAX dependency is removed. Original function and test names remain.

Admitted encodings are XML 1.0 in UTF-8 with or without a BOM, and UTF-16LE/BE
with a BOM. An absent declaration is allowed. A declared UTF-8 must match UTF-8
bytes; UTF-16 accepts either BOM order; explicit UTF-16LE/BE must match that order.
Encoding labels are case-insensitive. BOM-less UTF-16, other encodings, invalid
byte sequences, lone surrogates, odd UTF-16 byte lengths, a second leading BOM,
XML 1.1 and declaration/byte disagreements reject as `InvalidXmlError`.
This intentionally finite encoding profile never guesses an external charset,
performs replacement decoding or silently converts original bytes.

XML end-of-line and attribute-value normalization apply to decoded values.
Numeric character references preserve their actual characters; predefined XML
references are decoded. CDATA stays a distinct ordered node with literal contents.
Qualified names, expanded namespace/local names, namespace declarations, resolved
attributes and ordered mixed children remain available. Unprefixed attributes
have no namespace. Scoped rebinding and default undeclaration are preserved;
`xml:space` and all whitespace remain available without flattening or trimming
paragraph content. Text after children is retained in the parent's ordered content,
not lost through an element-only children array. Comments and processing
instructions remain inert, including before and after the root.

The policy was checked against [XML 1.0 fifth edition](https://www.w3.org/TR/REC-xml/),
sections 2.8, 2.10, 2.11, 3.3.3 and 4.3.3. No downloaded document or native reference
runtime was used. DTDs, internal/external entity declarations, undeclared entities,
invalid characters and unbound prefixes reject. XInclude-looking elements,
stylesheet processing instructions and URL-valued attributes remain inert data;
there is no resolver, host filesystem, eval, network or user callback capability.

## Budgets and JS mapping

Omitted or explicitly undefined options use defaults. Supplied numeric values
must be positive safe integers; unknown option names reject
with `InvalidValueError` (`usage`). Non-byte input raises `InputTypeError`
(`usage`). Syntax/encoding errors use `invalid-xml`; exceeded budgets use
`ResourceLimitError` (`limit-exceeded`). Future CLI routing retains shared exit
statuses 1/2/4 for these categories and the shared JSON envelope.

| Option | Default | Charge |
| --- | ---: | --- |
| maxBytes | 32 MiB | Input bytes before copying/decoding |
| maxDepth | 256 | Element nesting |
| maxNodes | 2,000,000 | Elements |
| maxContentNodes | 2,000,000 | Elements, attributes, retained text/CDATA/comments/PI, including document siblings |
| maxAttributes | 2,000,000 | Total attribute declarations |
| maxAttributesPerElement | 128 | Attributes on one element |
| maxNamespaces | 256 | Bindings in a scope, including implicit xml |
| maxTextLength | 32 Mi UTF-16 code units | Cumulative decoded text, CDATA, attribute values, comments and PI data |
| maxWork | 512 Mi units | Input bytes plus all parser generator work charges |

These are explicit trusted codec options; future untrusted CLI overrides must
be checked against host ceilings by the later context/limits task. There are no
environment variables. Input bytes bound decoding/token storage; text and content
ceilings separately bound retained values/objects. Work accounting drains the
shared cooperative scanner and closes it on failure. This synchronous codec
provides a work ceiling, not event-loop cancellation or a wall-clock SLA; later
cooperative execution/aggregate document budgets must build on that boundary.
Decoder calls use fixed 4096-byte chunks and preserve incomplete code points
across calls. Unit cases split both UTF-8 characters and UTF-16 surrogate pairs.

`root` is the existing plain typed parser tree. Collections use arrays and Map,
zero-based lookup, `.length`/`.size` and standard JS iteration. Missing attributes
remain absent, distinct from empty attribute values. Names stay strings rather
than Python string subclasses. This codec exports no dynamic element-class
registry or arbitrary XML dependency runtime API. Future owner-bound
`XmlElementView`, `.element`, `._drawing` and `.part` members remain public and
pending regardless of underscore spelling. Neutral model spellings, inherited
members, enums and all other public inventory obligations are unchanged.

Read `docx.md`, `office-cli.md`, `office-sdk.md`, the API audit/reconciliation,
920-record API inventory, public API map and all 15 crosswalk rows assigned to
this task. Historical evidence is preserved. The crosswalk's suggested
`packages/office-package/tests/namespace-xml-read.test.ts` location is superseded
by the actual DOCX test and shared parser regression files below. This resolves
location drift without changing old evidence into claimed passing runs.
No public model API rows are counted as implemented by a low-level codec.
No CLI commands/schema/capabilities are registered; plural resources, `text
replace`, selectors and envelope parity remain requirements of later tasks.
There is no visual CLI change needing a screenshot.

## Exact crosswalk dispositions

Rows below are one-based within `test-case-map.json` rows whose
`owning_task.id` is `namespace-xml-read`. These are explicit observable mappings,
not a claim to have executed or reproduced reference code.

| Rows | Original target assertions and scope |
| --- | --- |
| 1–3 | Namespaced root identity, supplied attributes and additional bindings: DOCX ordered-content and alternate-prefix cases. Native class identity maps to `kind`, `name`, `namespace`, `localName`; constructor/serialization behavior belongs to later structured creation/writing. |
| 4 | Deliberate fidelity difference: inter-element whitespace is retained, including inherited `xml:space`. The original whitespace/normalization regression asserts this contract; stripping is not copied. |
| 5 | Owned UTF-8 byte parsing with original non-ASCII text and BOM coverage. |
| 6 | Byte-only document boundary rejects JS string input, irrespective of declarations. Callers explicitly encode text; no implicit declaration/JS-string encoding guess. |
| 7–8 | Registered native classes are security-mapped to uniform inert typed element records and namespace resolution. Arbitrary parser hooks reject and are never invoked; no user class registry. |
| 9–10, 12–15 | Qualified string, local name, expanded URI and scoped prefix bindings are asserted directly with alternate/rebound prefixes. No string-subclass identity or mandatory Clark-name string allocation. |
| 11 | Clark-name-to-prefix construction is a structured writing concern retained for `loss-preserving-xml-write`/`sdk-xml-package-views`; reading preserves the original qualified name and resolved URI and introduces no unused constructor. |

Primary tests: `packages/docx/src/package-xml.test.ts` and
`packages/safe-fs/tests/xml.test.ts`. All data is original, small and independent
of downloads. Filesystem mutation assertions use memfs. Existing package graph,
archive, admission, independent structure and fixture tests are preserved.

## Red/green and checks

Starting main revision: `2e76b1127f521519e2a861035e60d55a489f337a`.

- Before shared changes: 10 new failures, 18 existing passes in the XML parser
  suite (lost document siblings, missing text ceiling, permissive declaration
  case and rejected generic UTF-16 labels with known byte order).
- Before DOCX changes: 38 failing cases; the existing package scanner concretely
  accepted a UTF-16 declaration on UTF-8 bytes, and the new typed codec was absent.
- Additional review reproduced two failures for whitespace references outside
  the root and one failure for double-BOM removal before their corrections.
- Further configuration regressions reproduced four non-object admission failures
  and one undefined-default failure before correction. Final XML tests: 79 passed
  (48 DOCX + 31 shared).
- Initial unchanged DOCX suite plus new tests: 198 passed before the final four
  original acceptance cases. Final maintained checks are recorded below.
- Selected maintained build: `npm run build:workspaces -- --workspace=docx`
  passed for the declared three-package dependency closure.

- Final maintained DOCX tests: `npm run test --workspace=docx`, 208 passed.
- DOCX lint and production/test declaration checks: `npm run lint --workspace=docx`, passed.
- Shared parser plus existing WebDAV/S3 XML consumers: 113 passed across four files.
- Shared ESLint and `npm run typecheck --workspace=@poe-code/safe-fs`: passed.
- Rebuilt final selected workspace closure and exercised the built ESM entry point
  with an independent ordered-content assertion: passed.
- `git diff --check`: passed.
- The first full `npm test` overlapped the final configuration TDD cycle: its
  loaded older module rejected new green expectations. Stopped that run (143),
  retained `/tmp/docx-namespace-npm-test.log`, and restarted the maintained route
  against settled source at `/tmp/docx-namespace-npm-test-final.log`. The interrupted
  run is not a gate pass. No product edits follow the final restart.

Repository-wide `npm run lint` passed (ESLint, type contracts and workflow lint);
log: `/tmp/docx-namespace-npm-lint.log`.

The pre-commit full `npm test` finished its shared Vitest phase and shell phase,
then exited 1 on the single committed-export lock guard. Shell accounting was
38,876 tests: 38,052 passed, 1 failed, with the remainder reported skipped/todo
by the maintained runner (not promoted to passes). The isolated original S3
export test reproduced the exact assertion at `verify.mjs:154`: the working
workspace lock must equal the selected committed lock. Its diff is precisely the
owned DOCX dependency replacement. This check cannot qualify an uncommitted
lock change against `HEAD`; no unrelated source fix or guard relaxation is needed.
Log: `/tmp/docx-namespace-s3-reproduction.log`.

Scoped task checks passed before the implementation commit. After committing the
owned files, rerun the committed-export check and full maintained test route with
the matching lock. Final validation receipt will follow; no push or release is
authorized.

## Final committed validation

Implementation commit: `bf7f37bda32f6c6dc9dd91ad6e1e676a40a6d126` on main.
The original isolated packed-export test passed against that commit (1 passed,
0 skipped), without changing or weakening its guard. Log:
`/tmp/docx-namespace-s3-committed.log`.

The final maintained `npm test` exited 0 against the committed source and lock.
Its declaration-derived report records 44 test tasks, five required builds,
uncached execution, concurrency one and no excluded workspace. Native pre/post
hooks ran. Workspaces without declared test tasks retained
`NO_DECLARED_TEST_NOT_A_PASS` dispositions. The shared parser's own focused
113-case run remains separate evidence, not a fabricated workspace test task.

The shell phase recorded 38,053 passed, 823 skipped and zero failures; SafeJS
recorded 28,932 passed and 47 skipped across 1,301 passing and two skipped files.
The subsequent terminal workspace passed 288 tests, and root posttest passed its
two lint stress tests. Optional/unavailable cases remain skipped, not coverage
passes. Full log: `/tmp/docx-namespace-npm-test-committed.log`.

The task is complete within its bounded reading scope. The final receipt changes
only this plan; all product/test/manifest bytes remain those verified in the
implementation commit. Existing pipeline edits and the unrelated plan move are
preserved. Serialization and every later task remain pending. No push or release
was performed.
