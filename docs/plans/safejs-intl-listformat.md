# Intl.ListFormat gap

## Current evidence

The locally installed NumberFormat candidate at
`/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safejs-numberformat-consumer.rKS0Er5yXB`
returns `undefined` for `typeof Intl.ListFormat`. The same probe confirms missing
DateTimeFormat, public PluralRules, RelativeTimeFormat, Segmenter, DisplayNames,
and DurationFormat. NumberFormat work does not complete the Intl surface.

No ListFormat implementation or test has been added. The full maintained test
run 43555 is active and source/tests are frozen until its terminal result.

## Required implementation evidence

Validate native behavior on both supported Node 18 and current Node before
selecting a backend. Add failing guest tests for constructor/new-only behavior,
locale and option coercion order, supportedLocalesOf, resolvedOptions, format,
formatToParts, empty and singleton lists, all styles/types, and subclasses.

List conversion must consume guest iterators through the interpreter, reject
non-string elements instead of coercing them, and perform iterator closing where
required. Test abrupt next/value access, invalid elements, overridden return,
and observable getter order against the specification and native behavior.

Keep native formatter state private. Guest objects need proper brands, property
descriptors and prototypes, memory accounting, and snapshot serialization and
restoration, including cycles and custom properties. Validate forged serialized
options and preserve identity through repeated replay. No native function or
object capability should leak through returned parts or resolved options.

After NumberFormat delivery and resolution of current validation failures,
implement this as a separate atomic improvement, with its own checks, commit,
push to main, and release monitoring. Do not infer that other Intl gaps are solved.

## Native controls on Node 18.18.0 and 24.14.0

Both versions produced identical read-only probe results:

- Construction observes newTarget.prototype first, then locale-list length,
  membership/value, and option getters localeMatcher, type, style in that order.
- Calling without new throws TypeError. Null, numeric, non-iterable object inputs,
  and boxed-string elements throw TypeError rather than undergoing string coercion.
- format(undefined) returns an empty string; format("ab") iterates characters and
  produces "a and b" for English defaults.
- A non-string iterator value reads next/done/value, calls return, and throws
  TypeError. If return itself throws, the original TypeError remains authoritative.
- Errors from next(), the done getter, or the value getter propagate without
  calling return. Do not implement an indiscriminate finally-close loop.
- formatToParts(["a","b"]) produces element "a", literal " and ", element "b".

Use these controls together with ECMA-402 StringListFromIterable when adding TDD
coverage: https://tc39.es/ecma402/#sec-stringlistfromiterable
The replacement full-test run is now 88870; the previous 43555 terminated on the
separately fixed Maestro concurrency assertion. No ListFormat runtime changes yet.

## September 8 implementation start

NumberFormat is now delivered on remote main as ecf4cf21b; scoped and CLI release
jobs are still active. The unrelated camera early-guest-closure experiment was
rejected after interleaved measurements showed no useful speedup; its runtime
patch and newly authored experiment test were removed without changing existing
semantic tests. The six weak-collection/promise-property gap tests remain intact.

Added 14 native-comparison ListFormat cases for constructor metadata, options,
styles/types, parts, subclassing, supported locales, iterator errors, receiver
brands and descriptors. Initial run 51940 had 12 failures and two misleading
TypeError matches caused by the absent constructor. The tests now explicitly
require the constructor before each scenario so a missing API cannot satisfy
negative behavior checks. No ListFormat implementation has been added yet.

Re-read current ECMA-402 StringListFromIterable: undefined produces an empty
list; IteratorStepValue errors propagate, and non-string elements trigger
IteratorClose with TypeError. This matches the previously recorded Node 18/24
native controls. Use guest iterator machinery, not a host loop over guest input.

Initial implementation 23984 passed all 14 native comparisons. Added a fifteenth
constructor-prototype descriptor test; 17731 reproduced writable:true instead
of native false. The constructor now explicitly defines writable:false.
The implementation uses a private WeakMap formatter state and guest iterator
acquisition/result reads; only invalid element types invoke preserve-throw close.
List accumulation charges step, array-length and data growth budgets. Snapshot
serialization/restore, private state measurement and additional budget/iterator
controls remain required before committing or pushing.

NumberFormat release 34224902200 completed successfully and its provenance
publication log confirms @poe-platform/safe-js@0.1.450 at 12:17:35 UTC. CLI
34224902433 remains active at the latest poll; no CLI publication claimed.

Run 51710 reproduced uncounted private options (1 versus expected 37) and loss
of formatter brand after snapshot restore. Added a guest-listformat heap node,
strict locale/type/style validation by canonical reconstruction, restore support,
and private option traversal. Run 93205 passed all 17 tests. Added five forged
option cases and pending/completed public checkpoint replay controls; these passed
in 65547. That combined run exposed only two exact legacy intrinsic-inventory
mismatches. Added the ListFormat constructor explicitly to both expected maps;
historical fixtures and comparison rules are unchanged. Combined run 68251 and
selected workspace build 34023 are now running. Previous focused ESLint 81806
passed the initial four implementation/test files; later snapshot/accounting
edits still require lint and broader checks. No ListFormat commit or push yet.

Combined run 68251 passed 68 tests with one skip. Build 34023 failed because
TypeScript's Intl.ResolvedListFormatOptions interface did not satisfy the dump
format's JSON record union. Replaced the serialized-state interface with an
explicit locale/type/style type alias; no dump validation/casts were weakened.
Build 44941 is rebuilding the corrected type.

Expanded native controls for newTarget prototype order, invalid option
short-circuiting, supportedLocalesOf option isolation, invalid list elements,
and next/done abrupt completions. Added generator accumulation, string-work and
formatted-output resource-limit tests. Run 37031 passed all 33 ListFormat tests.
Lint 94903 covers all ten changed source/test files and is active. Further broad
runtime and built Node 18 checks remain before delivery.

Build 44941 passed all 23 selected workspace builds plus four fresh native import
checks. Lint 94903 passed all changed code/test files; git diff --check passed.
Fresh built-runtime probes passed on Node 18.18.0 (47003) and Node 24.14.0
(45846): 270 exact native comparisons per runtime covering six locales, all
three styles and types, five list inputs, formatted strings, parts, and resolved
options. Pending and completed public dump/restore replay controls also passed
on both versions. These are repository-built runtime checks, not installed
release tarball qualification. Starting the full unexcluded SafeJS workspace
unit route; keep source/tests unchanged until its terminal result.

Unexcluded workspace regression 13918 finished: 20500 passed, 37 skipped, six
failed; 692 passing files, one skipped, two failing files, 448.85 seconds. All
failures are the existing explicit weak-collection and host-promise property
gap tests; none are ListFormat or timeout failures. This is not a green full
suite. The separately validated NumberFormat bundle-initialization correction
is now in progress before delivery; ListFormat remains uncommitted.

Bundle initialization fix 8ae46160e4cff5cff2ddf5730356308b44ed8e27 was committed
and pushed separately after 108 focused tests, full root build 95306, lint,
actual Node 18/22 CLI syntax/startup checks, all packed smoke checks (66124),
and visual help inspection. Its release jobs are active, not yet published.

Final ListFormat qualification through the canonical `poe-code/safe-js` public
export passed on Node 18.18.0 (34168) and Node 24.14.0 (14804): 270 native
comparisons and both pending/completed replay cases per runtime. These use the
actual completed root build, including the corrected synchronous backend.
The full workspace's six explicit remaining gap failures remain unresolved and
are not hidden or claimed fixed by this feature. ListFormat is ready for its
own atomic commit and direct push without waiting for the prior release.
