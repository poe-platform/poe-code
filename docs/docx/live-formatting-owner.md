# Retained formatting owner validity

This bounded correction belongs to the open `sdk-live-object-model` task.
It does not establish whole-public-API conformance.

An original acceptance test retains Font, ColorFormat, ParagraphFormat and
TabStops obtained from one ParagraphStyle. Each reports the same part owner
before deletion. After style deletion, metadata and equality access throw
RangeError; adding a new style with the same name cannot revive those views.

The failing-before-code run reproduced stale metadata at `view.part`.
The focused test passed after the existing formatting owner binding was changed
from captured metadata to live validated metadata. No alternate editor, fixture
binary, external identity, ambient I/O or network capability was introduced.

Exact JavaScript mapping: synchronous getters retain the actual shared part
object, and synchronous equality uses the stable style-token/format-kind owner
identity. Deleted token access raises RangeError (the mapped stale-owner error).
Inherited formatting properties remain live. This extends the ownership mapping
in the API register; it does not alter the historical API or source-test
inventories, claim their cases adapted, or change documented neutral spellings.

Remaining work includes the Document factory and full paragraph/run, table,
section/story, comment, and general package/XML public owner graph. No missing
public underscore-prefixed type is reclassified as private. Later collection,
value, async-capability and full case-adaptation tasks remain pending.

Verification: the focused regression and adjacent live-style/formatting suites
passed (46 tests across three files). Maintained `npm run lint --workspace=docx`
passed ESLint and both TypeScript configurations, with one warning in the
untouched operation-type test. Scoped formatting and `git diff --check` passed.

The clean final maintained `npm run test --workspace=docx` run passed all
179 files: 3,439 passed tests and four skipped tests. The skipped tests are not
counted as passes. The earlier full run retained the expected failing regression
from before implementation; it is superseded by this clean final run.
