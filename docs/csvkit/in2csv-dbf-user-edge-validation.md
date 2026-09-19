# DBF user edge validation

This follow-up adds 69 native differential observations: 59 header/layout/flag cases in in2csv-dbf-user-edge-reference.json and ten independent scalar/memo cases in in2csv-dbf-user-stress-reference.json. The executable hash matches the frozen CPython 3.14.2 profile, and the hash-required dependency lock fixes csvkit 2.2.0, Agate 1.14.2, agate-dbf 0.2.4, dbfread 2.0.7 and SQLAlchemy 2.0.54. Reference subprocesses are ad hoc tooling only. Canonical tests use memfs or MemoryFileSystem and execute no native programs.

The 59 layout observations cover unfamiliar version bytes, mismatched record widths, starts inside headers and beyond EOF, active/deleted/unknown separators, truncated character records, zero-width field types and ignored common flags. They match the engine exactly; native replay verifies exact output/status and unchanged directory/file snapshots. Independent actual-Shell testing reproduced three mismatches before the codec fix: non-ASCII whitespace bytes were incorrectly accepted in date components and memo indexes. These now produce the native ValueError, empty stdout and status 1. See in2csv-dbf-user-stress-validation.md for the original failures and control cases.

Final scoped checks passed:

- Maintained domain `npm test --workspace=@poe-code/csvkit`: 3,138 passes across 56 files; one skipped and six TODO cases remain unqualified. The DBF file contributes 166 passes.
- Maintained domain lint: ESLint and source/test TypeScript checks pass. Focused final ESLint for the changed codec, DBF tests, new Shell tests and membership assertion also passes, as does Git whitespace validation.
- Maintained selected `npm run build:workspaces -- --workspace=@poe-platform/safe-bash`: all ten declared dependency-closure build stages and safe-bash postbuild pass without a cache shortcut.
- Focused actual-Shell csvkit, in2csv, output-ownership and both DBF stress files: 37 passes, zero failures/skips/TODOs. These include producer reuse, awaited output and delayed cooperative cancellation cleanup.
- Maintained integration-inputs.test.mjs: 109 passes, including explicit discovery of the new DBF user stress file.

Ad hoc screenshot inspection through the maintained renderer and a built, explicitly bound safe-bash plugin host shows the exact memo-index ValueError/status 1 and successful float CSV `v\n1.0\n`/status 0. The root CLI does not expose the necessary csvkit host bindings. Owned temporary reference environments, fixtures, screenshot host and PNG are purged after validation.

These are scoped checks, not a repository-wide or release gate. The blockers in docs/specs/in2csv-dbf.md remain explicit, including glob filenames, unqualified multibyte driver codecs, concurrent mutation, compressed sources, exotic numeric/timestamp boundaries and service-backed filesystems. A case-collision oracle could not be measured on this case-insensitive host filesystem; that attempted observation is excluded from the corpus. No README additions, staging, commits, pushes or publication were performed.
