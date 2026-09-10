# DateTimeFormat option-order oracles

## Validated problem

The Node 18.18.2 run of `intl-datetimeformat.test.ts` fails three tests and
passes 49 (eb61aa). The tests ask the host for observable option-reading order:
it reads year before rejecting an invalid zone, reads fractionalSecondDigits
twice, and performs a preliminary pass over components before resolution options.
The guest's single-pass behavior differs, so blindly following these failures
would introduce a regression rather than repair the runtime.

## Normative evidence and correction

[ECMA-402 CreateDateTimeFormat](https://402.ecma-international.org/#sec-createdatetimeformat)
resolves locale options first, reads and validates timeZone before components,
then reads components once in Table 16 order, followed by formatMatcher and the
styles. FractionalSecondDigits uses GetNumberOption with bounds 1 through 3;
an abrupt completion stops the operation before timeZoneName. Default component
selection reads the internal formatOptions record, not the guest options again.

Replace only these three host-derived expectations with explicit specified
results. Preserve the invalid-zone and invalid-fraction cases, add throwing
later getters and an ownKeys trap, and assert the complete ordered trace.
Keep native comparisons for the unaffected locale-output/metadata cases.
Do not change production option reading, weaken equality, skip tests on older
hosts, or fold the unrelated private requested-options budget edit into this
atomic correction.

This is a correction to the qualification oracle, not a new language feature
or a fix for numeric offsets or reversed ranges. Those confirmed older-host
formatting gaps remain open. No push or release.

Qualification: the corrected working-tree file passed all 52 tests on Node
18.18.2 (ffb20b) and Node 22 (9cc77a); scoped ESLint passed in the latter
invocation. Counts are unchanged: the two removed native-derived cases became
two explicit specification cases, and the full option-order case was strengthened.
No runtime source, public interface, or CLI output changed in this correction.
The unrelated requested-options budget expectation remains uncommitted with its
Temporal integration and is not part of the oracle commit.

The final file also passed all 52 tests on Node 26.4.0 (51b36b). These three
runtime selections overlap; they are not 156 independent test cases or a full
package gate.
