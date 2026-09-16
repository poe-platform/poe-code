# Qualify runner fixtures after opt-in packaging migration

The release at `6eea146327da1b92b2943ac91a7ebd0731e58c67` failed Bash
runner gates before native tests: the compilation fixture imported the removed
optional-package builder, and the root export fixture expected the previous
output layout. Both failures reproduced through the maintained workspace runner.

Update the fixtures to import the maintained builder, declare the core's public
peer metadata, and inspect `safe-bash/dist/opt-in`. Assert the exact eight graph
and entrypoint files, rewritten public imports, absence of compiler maps and core
index copying, and closed descriptors. Root export expectations preserve exact
declared subpaths while accounting for the copied `dist/safe-bash-opt-in` graph.
No product code or historical fixture bytes change.

Validation: `npm run test:runner --workspace=virtual-bash` passed all 522 tests;
the root optional build, lifecycle and copied-package suites passed all 71 tests.
The runner correction was independently delivered on remote main in
`5bbe9fa80`; drop the overlapping local correction during rebase and preserve
that commit's package-name and workspace wiring updates. The local 522/71 results
above qualify the earlier packaging candidate, not those subsequent updates.

The guarded lint run also reproduced an unused export-key binding in the newer
packed-consumer fixture. Iterate the export values directly, preserving all
consumer imports and assertions. Guarded repository ESLint then passed with zero
errors and two warnings. Rebase the remaining correction onto current main,
check the rebased maintained runner, push and monitor GitHub publication.

## Consumer fixture namespace

Release `01dc744df` reproduced 24 consumer-resolution failures after the package
rename. The in-memory fixtures now declare and resolve
`@poe-platform/safe-bash` in both checkout and installed-consumer profiles,
including the scope directory required by the checkout symlink. All 24 tests
passed; export, declaration-byte, metadata and peer-closure controls remain exact.
Remote `20f6645ed` independently delivered this correction; the overlapping
local commit was dropped during rebase.

## WebDAV helper imports

The release also failed to load two active WebDAV integration suites because
their public mock helpers imported the previous package name. Update their root
and WebDAV subpath imports. The affected matrix, independent controls and consumer
resolution suites passed all 117 tests after a fresh dependency installation.
Remote `20f6645ed` delivered the mock-helper correction; retain only the
remaining active controls-helper import update.
