# HTML/XHTML overlapping rich-text follow-up QA

Manual QA procedure executed 2026-09-20 against the existing implementation.
Preserve prior edits and reports; no README edits, commits, push or publication.

## Procedure

1. Reverify the official archive under `out/ssconvert-lifecycle` with SHA-256
   `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
   Inspect the released HTML writer and its Pango iterator behavior.
2. Use the separate Docker colima oracle `ssconvert-statistics-qa`, binary
   `/out/ssconvert-statistics-oracle/prefix/bin/ssconvert`, version 1.12.61.
   Reference dependency/plugin/locale profile is captured in
   `ssconvert-html-xhtml-export-qa.md`. Set C locale, UTC timezone,
   memory GSettings backend and its installed schema directory.
3. Create original A1 text `abcd` with markup
   `@[bold=1:0:4][bold=0:1:3]` in an out-only Gnumeric fixture.
   Capture native bytes, status and diagnostics. Add an in-memory failing
   regression before changing source. After repair, compare all five native
   savers with actual `runCommand` and `createEngine` with injected byte I/O.
4. Ask a different agent to stress current code with independent fixtures,
   regressions and native negative controls. See
   `ssconvert-html-xhtml-followup-independent-qa.md` for its results.
5. Run uncached maintained ssconvert tests/lint and selected safe-bash build
   closure. Run the command integration suite and safe-bash typecheck separately.
6. Capture the actual shared command's exporter listing with the maintained
   screenshot tool, output only under out; inspect the PNG visually.
7. Record exact final source hash and limits, then remove run-owned scratch
   helpers, PNG and logs, retaining pre-existing archives and evidence.

## Results

The official archive hash and oracle version were reverified successfully.
The regression failed before repair: candidate bolded `bc`, native did not.
The writer now selects the latest active value for each markup attribute,
including explicit disabling values, before emitting tags. Unrelated active
attributes retain their ordering. All five actual command/shared-engine byte
comparisons passed, each status 0 with empty stderr. No native process is called
by product code or unit tests.

The exporter-listing screenshot was inspected: all five rows and descriptions
are readable with consistent column alignment. No visible CLI layout changed.

Verified source SHA-256:
`1028c1f4ec2ec0b0d1de54f27cf622e9f54e0ab5440dcc096741d9004341a37f`.

Gates and final independent results are recorded below after completion.

## Limits

Exact Gnumeric compatibility remains incomplete. The previously measured
text-overflow colspan discrepancy still requires the native rendering/span
semantics, including font metrics. This repair does not approximate them or
claim their parity. Width-dependent number truncation, wrapping, shrinking,
rotation, shaping, font fallback, conditional formatting, indexed format colors,
locale/dependency/plugin variants and alternate runtime cells retain the
unverified status from the existing reports. Native invalid UTF-8 markup
boundaries can produce nondeterministic output; supported-input validation is
preserved, and those cases are excluded from deterministic byte passes.

No full repository test/lint/build, full safe-bash unit suite, e2e or bounded
performance run was executed for this focused codec repair. Independent DOM
checks and existing command/SDK/replay, cancellation, budgets and destination
namespace controls are included in the package/focused command suites; they do
not establish unmeasured runtime cells as passes.

## Completed gates

- `npm test --workspace=@poe-code/ssconvert -- --no-cache`: final complete
  package rerun passed, 182 files / 4556 tests, zero failures/skips. Initial
  maintained run passed 181 files / 4553 tests before independent additions;
  it is not substituted for the final run.
- `npm run lint --workspace=@poe-code/ssconvert`: final package ESLint and
  source/test TypeScript checks passed.
- `npm run build:workspaces -- --workspace=@poe-platform/safe-bash --no-cache`:
  maintained declared dependency build closure passed, including safe-bash native
  postbuild script. Final declaration report: 85 selected workspaces, 18 builds,
  237 edges, 10 layers. Those are build declarations, not runtime coverage.
- `node --import tsx --test packages/safe-bash/tests/commands/ssconvert.test.ts`:
  all 54 tests passed, zero failures/skips/cancellations. This includes five-saver
  command/SDK equivalence, default saver, range metadata/split rejection,
  repeated sheet selection, replay and destination budget namespace controls.
- `npm run typecheck --workspace=@poe-platform/safe-bash`: FAILED, exit 2,
  before checking consumers. `tests/plugins/qualified-current-release/peer.mjs:245`
  requires root export `./safe-fs` to import
  `./packages/safe-js/dist/safe-fs.js`; current manifest has no such export.
  `git show HEAD:package.json` confirms it is absent there too. Gate reports zero
  current consumer groups and zero runtime executions, with cleanup complete.
  No unrelated public export or assertion was changed to bypass this failure.
- Manual native comparison helper initially failed before conversion because it
  omitted required engine limits. Supplying the documented limits allowed all
  five comparisons to complete. This harness error is not a product pass.

Independent measured coverage is separate from prior reports: 25 valid actual
command/native comparisons, plus root's five bold-reset comparisons. Historical
40 comparisons are not claimed as rerun in this session. Invalid UTF-8 markup
boundary output and the known overflow discrepancy are excluded from passes.

Local commits: none. Remote-main delivery: none. Releases/publication: none.

The separate agent reran the original overflow fixture across all five savers:
**five measured byte mismatches**, each native/product status 0, empty stderr.
Native emits `colspan="6"`; candidate emits a plain cell. This is the same
semantic issue measured in five variants, and is not a completed requirement.
The invalid UTF-8 boundary probe is separately unsupported, not a sixth valid
fixture pass. See the independent report for its nondeterministic native bytes.

Final regression hashes:

- `html-overlap.test.ts`:
  `f760e6524deaf3f1555805e51c6f6b26f0b4d33d741385d8e296c981e22ef5a4`.
- `html-write-stress.test.ts`:
  `38ddb1571b2f827f800c5c99d69899b62b2583e7d5ec05b0d7239df177ce9865`.

The full maintained package test route was repeated after the independent test's
label was corrected to distinguish direct writer checks from actual SDK checks.
