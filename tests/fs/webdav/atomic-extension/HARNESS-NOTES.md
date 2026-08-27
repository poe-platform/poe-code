# Preserved harness corrections

Before any production edit, the first unit invocation failed during module import:
`../mock.js` exports `MockDav`, not the mistakenly used `MockWebDav`. No behavior
tests ran (one failed test-file load). The fixture also requires the `/dav/` base
prefix. Both author fixture mistakes were corrected before the behavioral red
cohort. The shared mock itself is unchanged and is used only for metadata setup;
it is not the real-provider proof.

The first frozen candidate validation passed new33 and existing568, then failed to
load the historical LOCK regression's recorded Apache response: the snapshot
omitted `real-service/evidence/apache-final/raw.json`. The missing immutable input
was added to the snapshot manifest; no old test/helper/response was edited. The
failed candidate commands and cleanup are preserved in `evidence/source-candidate`.

The next cohort passed 33+568+23+23+5+28+49 but its ad-hoc TypeScript command
accidentally included default DOM definitions; existing Node `RequestInit.duplex`
then failed. Adding the project's `--lib ES2023` fixes that invocation without
changing source/tests. The failed type invocation remains in `evidence/source-final`.

`provider-first` stopped before dependency downloads or server start: the public
example's `Object.freeze` object method lacked an explicit input parameter type,
so strict packed-consumer compilation reported two implicit-any errors. The
parameter now uses the published request type. No production source changed.
