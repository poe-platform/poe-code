# Public WebDAV consumer compilation layout

August 27, 2026. Follow-up to committed408ff5991875199f3587e289ee1d9bbaed4d7f94.
Owned scope only: WebDAV documentation and backend consumer tests/tooling.
No adapter implementation, contracts, root config, shared dist or unowned edits.

## Exact cause and correction

The CURRENT normal `npm run typecheck` reproduced 13 errors, not the reported14.
All13 belonged to tests/fs/webdav/consumer: four TS2353 unknown compareEntry
constructor options, three implicit parameter types, five missing signal members,
and one incorrect receiver inference. No unowned compiler errors were present.
Raw output/exit2 are preserved under global-before. Package self-import resolves
the public export's dist/index.d.ts and dist/fs/webdav/webdav.d.ts, while the root
tsconfig includes tests/**/*.ts. The shared declaration lacked the new option;
current source and a fresh isolated build already contained it. Shared stale
declaration SHA256:094f357c6317a09d83689328de701fc2d86288ea997552b6cfb9ff351fa80f0f.

The three public consumer modules are now explicit .mts files; relative imports
and emitted runtime entry use .mjs. Original thirteen runtime assertions and
application resolver behavior are unchanged. This is a separate built-package
compilation target, not an unvalidated exclusion or stale-dist source test.
No cast, any, ignored error, root exclusion or weakened callback type was added.
The source-tree constructor callback type test remains in the normal .ts cohort.

consumer/run.mjs creates a fresh temporary git archive of committed production
source, copies current owned backend tests, builds its private dist, strictly
checks the backend .ts cohort and public .mts cohort, then runs plain Node against
the emitted consumer. It records pin/commands/raw results/source hashes/artifact
hashes. It does not touch shared dist or install a dependency. The documented
standalone command is `node tests/fs/webdav/consumer/run.mjs`.

Public types.mts independently asserts optional callback presence, exact
FileSystem receiver/parameters/result, bidirectional assignability to the shared
comparison signature and rejection of an incompatible receiver. Three separate
temporary declaration controls (required callback, wrong receiver, wrong return)
each fail TS2344 in these assertions. They do not modify product declarations.

## Results and limits

- Normal global typecheck BEFORE: exit2, 13 owned errors, zero unowned errors.
- Normal global typecheck AFTER: exit0, zero owned or unowned errors.
- Isolated package build: exit0; scoped backend/source types: exit0.
- Strict public consumer compilation including type assertions: exit0.
- Built-package serialized-HTTP consumer:13/13, no skipped/todo cases.
- Negative declaration controls:3/3 rejected as expected; not runtime tests.

An intermediate public type-assertion syntax mistake produced five parser errors;
that isolated attempt exited1 overall despite its runtime13/13. Its raw outputs
and original type-assertion source are preserved separately, not acceptance.
The final assertion syntax is corrected and compiled successfully.

Global checks ran the moving worktree based on e9783ecd393efd8af1b892c94f73a863d28650a7,
including unrelated dirty streams/text files. They are not clean-HEAD product
certification. Isolated production is pinned to that committed revision; source
and owned-test manifests remain identical before/after each isolated run. No
redundant whole-WebDAV/allFS/full-repository runtime suite was run: no adapter
TypeScript implementation changed. The original43/38 acceptance remains separate.

All source TypeScript under src/fs/webdav is byte-identical to408ff59.
resource-id.ts SHA256:ee5720f77a352503368d672caaf5237e45863bde88cf69b947d14178fcda49f2.
webdav.ts SHA256:36e9b5eb6f012df25bd5bb529d29716400f53a6ffa593d75b78f19f77c791b22.
The shared stale declaration hash is also unchanged; root package/tsconfig are
untouched. The only src change updates the README example filename to .mts.
Prior evidence, including the old reported14 claim (not reproduced here), is not
erased or rebaselined. Raw errors, exact old/new public modules, current source
hashes and isolated results are committed alongside this report.
