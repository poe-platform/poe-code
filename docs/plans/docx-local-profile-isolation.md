# DOCX integration gate profile isolation

The integration task requires SAFE_BASH_TEST_RG, SAFEJS_LOCAL_ROOT,
S3_HTTP_EXPORTS_REVISION and FULL_GATE_ROOT to reach only the virtual-bash unit
child. All were unset in the current actual gate environment. Inspection found
the maintained runner omitted the first name from non-feature child cleanup.

Before code, added an original regression to the existing runner test file.
Its minimal manifests live entirely in memfs at the real checkout pathname;
child processes are mocked. The runner's existing Git local-variable discovery
remains real and read-only. No test file is created on the host. The frozen parent
environment provides one explicit search profile. The test checks the build,
root unit, virtual-bash unit and another workspace unit child independently.

The original test failed because a non-feature child inherited
`/owned/search-profile` instead of undefined. Added SAFE_BASH_TEST_RG to the
existing cleanup list. The full original runner and DOCX export tests passed:
194 tests in two files, including parent preservation and existing local-Git
environment tests. No global/private Git configuration changes or optional
runtime/profile synthesis. This is runner wiring, not document product logic.

Raw original red evidence: `/tmp/docx-local-gate-profile-red.log`.
Green evidence: `/tmp/docx-local-gate-owned-unit.log`.
The red name-filtered run skipped 191 unselected tests; those are not passes.
The subsequent unfiltered focused run passed all 194 tests.

Broad maintained build/unit/lint evidence for the final runner revision is now
available. Runs started before this correction do not qualify its final revision.
Dependency builds and runtime unit checks must be sequenced to avoid invalidating
chunk imports while a check reads them. Preserve the earlier contaminated
virtual-bash capture separately; it is not defect or passing gate evidence.
No README, push, release or broad staging is authorized.

Final runner source passed normal root build and the full maintained
ESLint/type/workflow chain (zero errors, 14 warnings, all 25 guarded receipts).
The uncached root npm test completed root/shared workspace units successfully,
then passed all 522 virtual-bash runner tests. Its virtual-bash unit child failed
one unrelated PPTX affected-count assertion; 38,315 passed, 823 skipped, zero
cancelled/TODO out of 39,139. The separately maintained workspace npm test
reproduced the same result. No optional/private runtime or unselected case is
counted as a pass. Root posttest lint-stress did not run after the test failure.

The failed assertion expects affected=2 from a successful images.extract read;
actual affected=0 agrees with the shared Office read accounting contract. This
is an unrelated canonical test-contract drift, left unchanged under bounded
DOCX ownership. It is a failed required integration check, not proof that image
publication failed. Original memfs scenario and failing output are preserved.

The required passing-unit condition for commits is unmet. No files were staged
or committed; the focused verified correction remains reviewable in the working
tree. Raw final evidence: `/tmp/docx-local-gate-final-unit.log`,
`/tmp/docx-local-gate-final-bash-unit.log`,
`/tmp/docx-local-gate-final-build.log` and
`/tmp/docx-local-gate-runner-final-lint.log`.
