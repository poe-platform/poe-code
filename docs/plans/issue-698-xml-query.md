# Issue 698: bounded XML queries

The default shell has 82 commands and no XML query command. The initial tests
reproduce missing public factories and command-not-found on MemoryFS and mock S3.
Add `xq QUERY [FILE|-]` and `xmllint --xpath QUERY [FILE|-]`, with explicit standalone
factories and the same XML options available through the default agent preset.
The current default catalog becomes 84; immutable historical catalogs remain
unchanged and current expectations must declare the added names explicitly.

## Reuse and resource boundaries

Extract the existing hardened WebDAV XML scanner into SafeFS `src/xml.ts` and
export it through the existing public core entry. This preserves the shared
Node/browser bundle graph without adding another filesystem package route.
Keep the S3-specific parser unchanged. The shared parser must retain namespace
validation, DTD/declaration and unknown-entity refusal, iterative depth checks,
and independent structural and attribute limits.

The generator parser exposes charged work checkpoints inside long scans as well
as node admission. Queries drive these checkpoints through a task-yielding budget
that preserves cancellation reason identity. Rich mode retains attributes,
namespace declarations, and ordered text, CDATA, elements, comments, and processing
instructions. WebDAV selects lightweight retention and preserves its existing
children/direct-text model and response-admission timing. Do not remove a memory
cap to make a compatibility test pass.

Query limits bound source/input/output bytes, depth, all retained nodes,
attributes, per-element attributes, namespace bindings, work, and results.
Charge parsing, query traversal, deduplication, and serialization, including
output amplification when ancestor and descendant selections overlap. Read
only the supplied VFS or stdin and never resolve external XML entities.

## XPath profile

Support absolute child and descendant paths, wildcard names, terminal attributes
and text, positive positional predicates, attribute-equality predicates, and
outer `string`, `count`, and `boolean`. Apply predicates in order and positions
per parent; deduplicate and return document order. Unprefixed names select the
empty namespace, while wildcards include namespaced nodes. Query names use the
explicit ASCII NCName subset; Unicode XML names remain accessible by wildcard.
Reject unsupported queries before acquiring input, including prefixed names,
the document-only `/` expression, arbitrary axes, union, arithmetic, variables,
and unsupported functions. Do not silently approximate full XPath.

Use an explicit xmllint-style status profile: success 0, XML/I/O errors 1, CLI
misuse 2, configured limits 5, XPath errors 10, and an empty node set 11. Empty
scalar values remain successful. Native libxml2 2.9.13 returns 10 for empty sets;
the current xmllint documentation specifies 11, so record this deliberate profile
difference rather than claiming version-independent status parity.

## Validation and delivery

Use TDD for the shared parser, command behavior, public exports, and independent
oracle/resource controls. Preserve legacy WebDAV boundary tests and historical
fixtures. Independent checks cover mixed content, namespace semantics, positional
grouping, ordered deduplication, comments/PIs, refusal before I/O, independent
limits, false/object cancellation, and sink failures. Unit tests use memory only;
native oracle captures are separate temporary evidence.

Run focused checks first, then the maintained full build and `npm test` because
this change crosses SafeFS and SafeBash. Verify installed Node, Bun, browser, and
workerd consumers and public declarations. Inspect an ad hoc CLI screenshot.
Complete the final normal build and package lint before guarded root lint; do
not run builds, tests, or edits concurrently with guarded lint. Commit a concrete
candidate before the committed-archive gate when changed metadata requires it.

Push only after validation; verify remote main and every triggered release.
Install exact published versions and repeat the XML consumer checks before
closing #698. Local commits, remote delivery, and release success are separate
milestones.

## Focused implementation evidence

The shared parser passes 86 focused tests including the existing WebDAV limits.
The command suite passes 27 tests and the independent review suite passes 23.
Review reproduced and corrected invalid raw UTF-8 argument aliases, non-XML
whitespace in declarations, and mismatched UTF-16 declarations on UTF-8 input.
Additional regressions cover empty input chunks consuming work, predicates before
result-count admission, capped buffered reads, and BOM filename identity.

The current catalog cohort passes 404 tests; the separate portable replacement
cohort passes 11 after its custom-command count moves from 83 to 85. Historical
catalog inputs and source hashes remain unchanged. The normal build and focused
package metadata/bundle checks pass. An ad hoc screenshot verifies element and
scalar output plus empty-set and unsupported-query diagnostics.

Installed Node and Bun checks passed; browser bundling exposed a subpath defect:
`commands/xml` still reached a Node stream import. Add its portable output to
the same split browser build as the root entry, with explicit browser/workerd
export conditions. Preserve shared command and filesystem identities. A separate
native oracle caught carriage-return serialization: XML node output must escape
`&#13;`, while `string()` preserves the scalar carriage return. The command
regression suite now passes 28 tests after this correction.

Fresh scoped tarballs pass the same 20 acceptance checks in Node, Bun, a browser
bundle, and actual workerd. Public types pass Node/browser/workerd conditions.
The portable graphs have no external imports and select the XML browser entry
without the unbundled Node stream implementation. Final combined command and
independent tests pass 51 cases; bundle/metadata checks pass 40. The local
candidate still requires the maintained full test and serial lint gates before
push and published verification.

The first full shared run passed 20,362 tests and exposed two additional old
catalog assertions in the playground (kernel count and help text). Its maintained
workspace suite passes all 166 tests after updating those expectations. A wider
current-inventory scan reproduced 13 stale assertions across seven command and
integration test files; 14 focused checks now pass with the XML pair included.
The sealed historical source/hash transformation check still passes. These are
expectation updates only; the command implementation is unchanged.

The next full run passed the shared suite (20,364 tests) and reached all SafeBash
cases: 22,686 passed, 86 skipped, one failed, and two were cancelled by test
deadlines. The failure was a WebDAV diagnostic compatibility regression: the
attribute cap still rejected the oversized listing, but its cause became the
shared `XmlLimitError`. The DAV wrapper now translates that error back to its
original plain prefixed `SyntaxError`; 87 focused parser/DAV checks pass.
The two native-retirement scenarios reported success with no live workers before
their surrounding test deadlines expired. Their verification overhead is being
measured separately; no timeout or retirement assertion is waived.

Timing investigation showed native retirement itself completed in 797/868 ms;
reconstructing the peer graph took only 183 ms, so graph verification remains
unchanged. Snapshot census now hashes in batches of at most 16 reads after full
recursive admission. Every started read settles before a failure propagates;
no later batch starts on failure, and sorted hashes and symlink refusal remain.
Four memory-only tests first exposed serial overlap/draining behavior and now
pass, with independent review. The unchanged public cleanup file passes all 20
native and tamper scenarios under the original deadlines; the previously
cancelled cases completed in 6.27 s and 2.89 s. The rebuilt public WebDAV listing
suite passes all three cases, and maintained discovery passes 100 checks.
