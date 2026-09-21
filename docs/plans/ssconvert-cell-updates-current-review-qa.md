# Current cell-update candidate review

## Procedure

1. Preserve the existing implementation and historical native captures. Authenticate
   the retained 1.12.61 primary archive using the requested SHA-256; extract reviewed
   source only under `out`. Inspect `apply_updates` and the later forced calculation
   lifecycle against the command engine.
2. Have another agent independently test scoped names, original cache ownership,
   cancellation identity, work admission and negative cycle controls. Require concrete
   failing regressions before repairs. Root owns command integration and Git.
3. Exercise repeated scoped-name updates through both CLI and SDK in automatic and
   manual mode using original workbook objects and memfs file I/O.
4. Run fresh maintained ssconvert unit/lint routes and the selected uncached Safe Bash
   build closure. Run actual virtual-command tests, strict focused TypeScript and
   ESLint checks. Attempt the broader maintained Safe Bash typecheck and investigate
   failures without rewriting unrelated metadata.
5. Execute a virtual CLI host with successful repeated edits and a malformed named
   target through `npm run screenshot`; inspect the resulting screenshot. Record
   current source hashes and explicit unsupported/unverified cells separately from
   historical oracle results. Purge task-owned scratch after reducing evidence.

## Results for this review

The retained official source archive authenticates as
`2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
The existing implementation already covers ordered updates, range/active-sheet
resolution, inference, normal/clipboard/merge distinctions and dirty/manual/forced
calculation stages. Historical measurements remain in the existing reference profile;
they are not fresh native qualification of this review's candidate.

Independent review reproduced two failures before repair: same-spelled workbook and
sheet-local names prevented dirty propagation or produced `#NAME?` when forced.
Recalculation now tracks resolved named-expression objects in recursion guards.
Five independent tests include true cycle, abort identity, budget rejection and
source-workbook preservation controls. Two additional root CLI/SDK cases verify
ordered edits through automatic/manual calculation. Source confirms scoped lookup;
native admission and binding of this exact same-name fixture remain unmeasured.

Fresh checks pass: 599 package tests in 41 files; maintained package ESLint and strict
production/test TypeScript checks; selected Safe Bash build dependency closure with
`--no-cache`; 24 actual virtual-command tests. The initial concurrent lint caught an
unchecked test-array index; the reviewer corrected it and final lint passes.
Focused virtual-command ESLint and strict TypeScript results are recorded in the
candidate receipt. Unit fixtures do not spawn native processes or write host files.

The maintained broader Safe Bash typecheck fails at the public peer metadata guard,
before builds, consumer groups or runtime executions: root `./safe-fs` import mapping
is absent, whereas the guard requires `./packages/safe-js/dist/safe-fs.js`. The guard
and related negative tests were inspected; restoring that unrelated export would
change root API ownership and existing edits. This failure is preserved and is not
treated as a pass or excused by focused checks.

Manual screenshot inspection passes: the actual explicit virtual command reports
A1=8, A2=9, A3=10, status 0, then exactly `Failed to set cell Named=9`, status 1.
The virtual tool uses the shared engine and explicitly injected in-memory byte I/O.

Fresh native runtime matrix cells are unavailable: no installed `ssconvert` and no
retained running/stopped oracle container. The source archive and captured dependency,
plugin, locale and binary profile remain available. Existing unsupported function,
expression/coercion and circular-calculation boundaries remain explicit. Other locales,
full upstream formula/name binding grammar, exporter bytes, all budget boundaries,
large graphs and mid-execution host cancellation remain unverified as detailed in
the historical QA. Checkpoint/replay execution is not provided by this workbook
engine; no checkpoint/replay or hostile host-realm claim is made. No full repository
gate was run for this focused package repair. No skips are counted as passes.

No README edits, commits, pushes, publications or releases were performed. The
candidate is a live workspace snapshot, bound by file hashes in
`docs/ssconvert/cell-updates-current-review.json`, rather than a committed revision.
