# engine-csvcut contract and verification

Candidate scope, 2026-09-20: original shared parser/selector contracts plus the
csvcut record capability. The selected comparison release is csvkit 2.2.0 /
agate 1.14.2 / Python 3.9, against the source identities in the existing
[acceptance matrix](safe-bash-csvcut-acceptance.md). This record does not certify
full native compatibility or mark future behavior/wiring tasks complete.

## Inspection and ownership

The requested package-pattern document is deleted in the supplied working tree.
Its existing [archived successor](archive/safe-bash-command-package-pattern.md)
was inspected and preserved. Shared parsing remains in `safe-bash-csv-engine`;
the private `safe-bash-command-csvcut` owns the record-stream capability and
re-exports the shared pure contracts. Safe Bash only re-exports the command
owner. Dependencies remain engines → command → safe-bash, without return edges.

Inspected Pandoc `src/formats/csv.ts` and `src/delimited.ts`: its decoded-document
parser builds/pads an AST, has document budgets, LF-based input and strict quote
closure. It is not the required byte/dialect contract and was not copied.
Inspected `safe-bash/src/commands/table-text/internal.ts`: its command-specific
text/line budget and VFS helpers are not a shared CSV engine. XAN's CSV,
selector/writer and related paths remain integration-held per
`integration-boundaries.json` and excluded by `tsconfig.build.json`; only these
boundary declarations were inspected. No held source was read or imported.

## Accepted scope of the engine controls

Original failing tests preceded implementation. New shared-contract and command
engine tests use literal expected records/positions and memory byte producers.
No native executable, ambient filesystem, network or LLM is a unit dependency.

- Every possible two-chunk byte split and individual-byte chunks cover initial
  BOM, split UTF-8, CRLF, quoted newlines, doubled quotes and trailing empties.
- Separate controls distinguish empty files, blank records, quoted empty cells,
  delimiter-only rows and short records; no uniform-width enforcement exists.
- Strict-v1 rejects closure garbage (including escaped closure garbage),
  quotes following escaped unquoted prefixes, incomplete quotes/escapes and NUL. Invalid/truncated UTF-8 and unsupported
  quoting/profile controls return structured errors.
- Dialect controls cover tab precedence, custom quote/escape, skip-initial-space,
  physical skip-lines and quoting NONE. Parser options are captured at creation.
- Literal selector controls cover first duplicate, numeric headers, repetitions,
  untrimmed names, numeric whitespace/signs, colon/hyphen ranges, descending and
  open ranges, zero-origin, unknown exclusions, invalid exclusions and release
  open-end exclusion defects. Existing legacy selector behavior stays unchanged.
- Input/decoded/retained/field/cell/work exhaustion is invocation-local. Disposed
  parsers and ledgers are terminal. Producer reuse does not alter returned cells.
- Early consumer return, malformed input, quota exhaustion, abort during input
  and cooperative pending-read abort retire producers. Falsey abort reasons are
  preserved. The producer must honor the signal during pending reads/retirement;
  arbitrary hostile host code is outside this capability contract.
- Invocation signals are captured before producer execution. An omitted or
  explicitly undefined JavaScript profile preserves the strict stream default.

The profiles are explicit: `utf8-sig-strict-v1` is an isolation deviation from
Python's permissive reader, while `utf8-sig-permissive-v1` keeps the shared
engine's previous candidate semantics. Selection is `csvkit-2.2.0-ascii-v1`;
Unicode numeric grammar remains unqualified. Quoting 1/2 and unknown profiles
fail explicitly. Other codecs, Sniffer, compression, complete Python-version
errors/NUL handling and native release controls remain open. No inference,
locale/null conversion or later-source ignore-unknown flag is admitted.

These controls establish the scoped engine contract for subsequent behavior
integration. CLI grammar, projection, row deletion, names mode, exact native
diagnostics and CLI/SDK command parity remain in the subsequent tasks. Exposing
the engine subpath does not register a command or change CLI visuals.

## Artifact verification

The maintained memfs packaging control imports the public csvcut subpath and
executes literal multiline/selector/error controls in a Buffer-free isolated
realm after removing every private workspace. A strict TypeScript consumer
resolves the packaged declarations from that same isolated memory artifact.
Runtime and declaration dependencies are rewritten into the public artifact;
there is no unpublished runtime package dependency. This qualifies the maintained
packaging route, not a published release or an actual npm-install/manual native
oracle run.

## Checks and delivery

Passed scoped shared-engine tests (17), csvcut engine tests (8), existing
csvgrep tests (55), csvsort tests (21), package lint/typechecks, the private
command policy and the maintained isolated packaging/declaration control.
Packaging/private-build and workspace-membership tests passed together (162).
The guarded selected Safe Bash build passed. Repository `npm run lint` completed
with zero errors and four existing warnings in unrelated files; subsequent
engine edits passed their focused lint/typecheck routes.

The first full test run exposed missing root workspace membership; the second
exposed node:test files being collected by root Vitest. Root dependency and
explicit task declarations plus maintained test ownership were repaired without
changing assertions or dropping workspace tests. A new failing membership test
establishes that csvcut runs through its node:test workspace task, not Vitest.
The full-route retry completed successfully with exit code 0, including native
npm pre/event/post scripts and the final lint stress checks. Its maintained
declarations selected the workspace build/test closure with no excluded tasks.
Reported skipped controls, workspaces without declared tests and manifestless
directories are not counted as passes. The shared machine build cache remained
enabled; this was not a `--no-cache` qualification run.

The broader `@poe-platform/safe-bash` typecheck currently stops before source or
consumer checks at canonical peer admission: the root manifest does not export
`poe-code/safe-fs` through `./packages/safe-js/dist/safe-fs.js`. This task did not
rewrite unrelated publication metadata or weaken that check. The isolated
csvcut declaration consumer passes independently.

No visual CLI behavior changes, so no screenshot was applicable to this engine
increment. No native oracle or real npm-install/tarball qualification is claimed.
Local commits: none. Verified remote-main delivery: none. Successful releases:
none. No publication was requested or attempted.
