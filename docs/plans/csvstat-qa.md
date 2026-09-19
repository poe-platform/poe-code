# csvstat implementation and QA

1. Read root and safe-bash scoped instructions, inspect status/index, and retain
   unrelated edits. Inspect the existing source-derived descriptor and registration.
2. Verify the released 2.2.0 source archive against SHA-256
   `147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`.
   Replay the frozen CPython 3.14.2 dependency lock with C locale and UTC.
   Keep acquisition tools and temporary evidence in out; retained observations
   and source contracts belong in docs/csvkit and docs/specs.
3. Reproduce the scalar mean explicit blocker in an original failing in-memory
   regression. Capture exact native stdout/stderr/status for every OPERATIONS
   entry and all six inferred types, null/empty/singleton cases, frequency limits,
   selections, report formatting, CSV/JSON schemas and argument precedence.
4. Implement the literal descriptor's operation in the domain command file.
   Use the shared typed reader, precision-28 Decimal engine, injected process
   locale formatter and existing backpressured writer/cleanup machinery.
5. Delegate independent registered-command stress to a different agent; reproduce
   reported issues before fixing. Root owns source integration and exports.
   Register the new test's literal path in maintained discovery assertions.
6. Run the uncached domain workspace tests/lint and selected domain/safe-bash build
   closures, focused registered-engine tests, discovery tests and maintained
   source/test/public-consumer typecheck. Broaden only for uncovered shared changes.
7. Screenshot and inspect actual registered safe-bash detailed output. Record
   measured results, rendering limitations and remaining blockers. Remove only
   this task's temporary out directory after recording evidence.
8. Preserve README, staging and Git history; no commit, push or publication.
