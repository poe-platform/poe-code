# DOCX release verification

Release DOCX as an explicit opt-in. Existing default agent registration tests
assert absence from createAgentCommands and Shell, and exit 127 before opt-in.
Whole-API acceptance remains partial; publication does not establish full parity.

Reproduced the PPTX extraction test failure with the original memfs scenario:
19 of 20 selected Node tests passed; successful extraction reported affected=0
against an expected 2. Shared Office CLI read accounting requires zero, also
asserted by the package extraction tests. Correct only this stale assertion and
retain duplicate image publication, exact bytes and input preservation checks.

Integrate current remote main, run maintained full tests, lint and build, then
push main and monitor GitHub Release through successful publication.

## Local verification, September 16

Normal maintained build passed after stopping an overlapping screenshot-triggered
build; the contaminated missing-module result is not product evidence. Full
repository lint passed with zero errors and 14 warnings, including types and
workflow lint. Focused runner/export Vitest: 194 passed. Original DOCX opt-in and
PPTX extraction Node scenarios: 20 passed after the read-count correction.

Full npm test completed root/shared suites and downstream units. Virtual Bash
reported 39,694 tests: 38,870 passed, 823 skipped, one failed. The packed-export
test builds committed HEAD and ran before the merge was committed. After merge
d953f8ca3, its complete original suite passed all 221 tests, including packed
Node runtime and strict consumer types. No other failures were reported. Preserve
the nonzero full-run result separately; do not describe it as a clean full run.
The maintained lint-stress suffix passed both tests separately. Root-help
screenshot completed and was visually inspected. GitHub release gates must
qualify the delivered committed revision before publication is reported.

Logs: /tmp/docx-release-build-final.log, /tmp/docx-release-lint.log,
/tmp/docx-release-tests.log, /tmp/docx-release-exports-recheck.log,
/tmp/docx-release-lint-stress.log and /tmp/docx-release-screenshot-final.log.
