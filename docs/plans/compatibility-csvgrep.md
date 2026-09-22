# csvgrep independent compatibility qualification

The candidate is qualified only for the explicitly exercised subset. Full
csvkit compatibility is **incomplete**. Source targets are csvkit
`194c904256a09dc203c460944d35e9d414244503` and agate
`34856488cfcbe9077af8e3e557cbf98a044fdd64`; supplied native observations are
csvkit 2.2.0 / agate 1.14.2 / Python 3.9. Later source additions do not become
release observations. No held XAN source was read.

Candidate base: `ab1fa8d34101e1e7f61272973f3bc28a842043d8` plus the existing
uncommitted command/engine/composition/artifact graph. This task adds independent
controls and this receipt; no runtime implementation was changed. A source
fingerprint below identifies the actual working-tree candidate, because HEAD
alone does not contain the command. Toolchain: Node v22.22.2, npm 10.9.7,
TypeScript 5.9.3 and Vitest 4.1.11. Host Python is 3.9.6; `csvgrep`
is absent and Python distribution lookup for csvkit fails. Native cells were
not executed, installed or downloaded.

## Exact fixtures and controls

`packages/safe-bash-command-csvgrep/src/compatibility.test.ts` stores the complete
literal fixture bytes, argv, SDK options and expected output/diagnostics. UTF-8
encoding is explicit. Expectations come from the supplied contract, never from
candidate parsing or serialization. All input byte splits, including empty
chunks, execute independently through CLI and SDK; VFS file F uses one-byte
chunks. Host `PYTHONIOENCODING=ascii` is an intentional negative control.

| Cell | Required bytes/status/effects |
| --- | --- |
| physical-multiline | Physical line numbers 2 and 4, quoted multiline cell preserved; status 0 |
| missing-cell-short-row | `^$` selects the short row; output remains short; status 0 |
| unicode-digit-negative | ASCII flag excludes Arabic-Indic digit and includes ASCII 1; status 0 |
| absolute-end-negative | `\\Aabc\\Z` excludes final-LF cell and includes bare abc; status 0 |
| crlf-writer | Embedded CRLF becomes two LF inside a quoted cell; status 0 |
| empty-pattern-any-inverted | Omitted empty matcher, any then inversion retains both rows; status 0 |
| repeated-fields-inverted | Ordered y,x,y selectors, inversion after all aggregation; status 0 |
| numeric-header-position | Selector 2 means second position despite header named 2; status 0 |
| file-rstrip-precedence | Empty regex falls through to VFS F; whitespace lines become a and empty; cells with trailing space/tab excluded; status 0 |
| no-match-success | Exact `x` plus LF header; status 0 |
| invalid-open-group | Empty stdout, status 1, exact supplied Python release diagnostic |
| unsupported-named-reference | Explicit unsupported diagnostic, empty stdout/status 1; compatibility difference |
| unsupported-lookbehind | Explicit unsupported diagnostic, empty stdout/status 1; compatibility difference |
| unsupported-backtracking | Rejects `(a+)+$` before input admission; empty stdout/status 1; compatibility difference |

Every success has empty stderr, zero retained accounting after cleanup and one
closed stdin producer. Pattern errors do not advance stdin. Only the file cell
opens `/vfs/F`; no other file acquisition occurs. Repeated cleanup is idempotent.
The deterministic regex work-bound control exhausts 500 work units during
search, permits a fresh invocation and preserves a falsey cancellation reason.
It is not a wall-clock timeout or performance measurement.

`packages/safe-bash/tests/plugins/csvgrep-independent-controls.test.ts` uses
memory VFS `/input`=`x\na\n` and `/sentinel`=`unchanged`. No-match, invalid regex
and unknown-option pipelines have upstream statuses 0/1/2. Downstream cat gives
status 0 normally; pipefail gives 0/1/2 respectively. Exact output and candidate
stderr are asserted. Missing VFS match-file `/etc/csvgrep-control` fails before
CSV output, mocked fetch receives zero calls, and both original files remain
byte-identical. Unknown-option concise stderr is a candidate profile; native
argparse usage/error bytes remain unqualified.

## Manual QA steps

1. Run the maintained command workspace test and lint routes and selected
   `npm run build:workspaces -- --workspace=@poe-platform/safe-bash` closure.
2. Import built safe-bash root and public `commands/csvgrep/index.js`. In memory
   VFS write `/input`=`x,id\n"a\nb",1\nc,2\na,3\n` and F=`a\n`. Register
   csvgrepCommands and a command invoking SDK columns x/match a/lineNumbers true.
3. Require CLI and SDK complete-result equality; CLI output must be
   `line_numbers,x,id\n2,"a\nb",1\n4,a,3\n`. Require no-match pipeline status 0
   with header, invalid `(` pipefail status 1 with exact concise diagnostic,
   unsupported named reference status 1 with no CSV output, and match-file
   exact membership retaining only bare a. Require original input unchanged.
4. Capture and inspect terminal output with `npm run screenshot --` using the
   built-entry QA driver. This is a temporary manual driver, not a QA test
   dependency. Store it and the screenshot under task-owned workspace
   `out/compatibility-csvgrep`; absolute `/out` is read-only. Purge after review.
5. If authenticated native controls are available, independently execute every
   fixture/argv above against the release and pinned source profiles, record
   Python patch/Unicode version, distribution hashes, stdout/stderr bytes,
   status and effects. Otherwise leave these cells unverified.

## Missing qualification cells

Native release and pinned-source executions are unavailable, not passing.
Actual browser/workerd engines, complete original/checkpoint/replay profiles,
adapter-specific traversal/symlink containment, Sniffer, open ranges, independently
versioned zero ranges, all Python codecs/quoting constants/strictness/NUL/error
profiles, shared stdin `-f -`, compression and complete argparse diagnostics
remain unverified. Regex named/numbered captures, references, lookaround,
alternation, quantifiers, word categories, scoped/verbose flags and non-ASCII
ignore-case patterns remain unsupported. Existing candidate safety and artifact
checks do not certify those missing native/runtime cells.

No performance measurements were made. No full repository gate is claimed for
this narrow test-only increment. No private package publication, push or release
is authorized or performed. Existing unrelated edits were preserved.

## Verification receipt

Final focused gates passed, with no skips, cancellations or incomplete focused
runs:

- Command maintained `npm run test:unit --workspace=safe-bash-command-csvgrep`:
  55 passed, including 14 literal compatibility cells and deterministic bounded
  regex work/cancellation. Maintained command lint and both source/test
  TypeScript checks passed.
- Shared CSV engine maintained unit route: nine passed. Direct node:test
  execution of both csvgrep Shell boundary files: five passed. The new Shell
  file's ESLint check and `git diff --check` passed.
- Selected maintained safe-bash build closure passed, including private command
  declarations, guarded safe-bash integration and CLI postbuild.
- Root Vitest artifact controls (`bundle-safe-bash-private`, `package-safe`,
  `safe-command-publication`, `verify-safe-publication`): 224 passed. The packed
  isolated command graph removes workspace resolution, exercises branded byte
  arguments and public declarations, and checks private-package bundling.
  These are artifact controls, not a new installed tarball/native certification.
- Markdown manual QA steps 1–4 executed successfully against built public
  entries. CLI/SDK complete results, physical multiline numbers, match-file
  exactness, error/pipeline statuses and unchanged input bytes passed. Screenshot
  inspected: rows, statuses and concise diagnostics are readable. Task-owned
  temporary driver/image were purged. Step 5 remains unavailable.

Failure investigation: the first new matrix run failed one signal identity
assertion; inspection established a linked invocation-owned signal rather than
caller identity is intentional. The first Shell run failed one guessed unknown
option wording; the receipt now pins candidate `Unsupported option` wording
without claiming native argparse parity. An artifact attempt incorrectly used
node:test for Vitest files and failed four file admissions; the correct root
Vitest route subsequently completed all 224 tests. An apply-patch context
mismatch changed nothing and was retried with the actual file context. None
validated a runtime defect; no production repair or weakened safety check was
made. Absolute `/out` creation failed because the root filesystem is read-only;
the documented workspace evidence directory was used and cleaned.

Candidate SHA-256: `f645d8bc3ffa02da9c5932a30d6d367fcc5c9cdc5e9e599ee3ee2f9dbb87b047`
over 817 files. To reproduce, collect every regular file recursively beneath
`packages/safe-bash-command-csvgrep`, `packages/safe-bash-csv-engine`,
`packages/safe-bash-contracts`, `packages/safe-bash/src`, and
`packages/safe-fs/src`, excluding path components `dist` and `node_modules`.
Add existing files from this explicit list:

```text
packages/safe-bash/package.json
packages/safe-bash/scripts/build.mjs
packages/safe-bash/scripts/integration-inputs.mjs
packages/safe-bash/integration-boundaries.json
scripts/bundle-safe-bash.mjs
scripts/package-safe.mjs
scripts/safe-command-publication.mjs
packages/safe-bash/tests/plugins/csvgrep-independent-controls.test.ts
packages/safe-bash/tests/plugins/csvgrep-boundaries.test.ts
```

Deduplicate relative POSIX paths, sort lexicographically, then hash sequential
UTF-8 path, NUL, original file bytes, NUL for each file. This covers the reviewed
implementation/composition/contract/filesystem graph and named artifact inputs;
it is not a whole-repository or lockfile fingerprint. Fixture-source SHA-256:
`3f8bc9a96885dc844a7d272bee2160fa973ed83b0739a5bcdd1be1eb93d25517`;
new Shell-control SHA-256:
`f3aa587638d9e9f04edc0652352e34fef76adc2382ca46c18466423fa8d1d529`.

All final deterministic checks agree with their exercised profiles. Three
explicit regex capability differences remain recorded above; they are passing
rejection controls, not Python semantic compatibility passes. Full repository
`npm test`, repository-wide lint and root `npm run build` were not run for this
focused test-only increment. No focused rerun is described as a completed broad
gate. No commit, verified remote-main delivery or successful release was created
by this task.
