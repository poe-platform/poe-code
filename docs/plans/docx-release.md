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
