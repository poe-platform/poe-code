# ssconvert shell and real-adapter QA

Root owns this procedure, integration, exports and Git. Execute the steps as an
agent; this document is the QA procedure, not a TypeScript QA program. Preserve
existing edits, do not edit README files, push or publish. Use only owned scratch
`out/ssconvert-shell-workflows`; reduce observations here before deleting it.

## Procedure

1. Read root and Safe Bash instructions and inspect current command/SDK wiring.
   Before any runtime repair, reproduce a concrete failing case with an original
   fixture. Unit regressions must use memfs and mocked capabilities, never native
   utilities, LLMs or disk writes. Do not invent repairs for audit findings.
2. Download the official Gnumeric 1.12.61 archive into scratch and authenticate
   SHA-256 `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
   Inspect the existing captured dependency/plugin/locale profile at
   `docs/ssconvert/reference-profile.json`. A fresh native comparison requires
   that qualified binary and explicit profile environment in a separate oracle
   process, outside the virtual shell. Unavailable oracle cells remain unverified.
3. Build the selected Safe Bash workspace dependency closure uncached with
   `npm run build:workspaces -- --workspace=@poe-platform/safe-bash --no-cache`.
   Inspect public built exports and use one realm for Shell, registry and plugins.
4. Create an original two-sheet workbook in memory: First!A1 = "alpha",
   First!A10 = 9, Second!A1 = "βeta". Use the actual SDK engine with injected
   resource I/O to create XLSX, ODS and Gnumeric fixtures. Bind codecs, limits,
   locale C and UTC explicitly. Preserve an unrelated sentinel file.
5. Execute each example through literal argv using a registered test invocation
   command that calls `context.invoke('ssconvert', argv)`; no shell reconstruction.
   Repeat through real VFS `.sh` files executed by `sh`. Quote operands and expand
   shell variables in the scripts. Inspect status, both byte channels and exact
   namespace effects independently:

   - `ssconvert input.xlsx output.csv`
   - `ssconvert -T Gnumeric_stf:stf_csv input.ods fd://1`
   - `cat input.csv | ssconvert -I Gnumeric_stf:stf_csvtab -T Gnumeric_Excel:xlsx fd://0 output.xlsx`
   - `ssconvert --set 'A11==A10+1' --recalc input.xlsx updated.csv`
   - `ssconvert -S input.ods 'out-%n-%s.csv'`
   - `ssconvert -M combined.ods one.xlsx two.xlsx`
   - `ssconvert --export-graphs -T png input.gnumeric 'chart-%n.png'`
   - `ssconvert -T Gnumeric_stf:stf_csv -O sheet=Second input.ods fd://1`
   - configured text export with explicit separator, CRLF and encoding options.

6. Compare file/stream bytes with SDK-equivalent conversions and read binary
   pipeline output back through the engine. Check PNG signature and inspect the
   generated chart image. Include non-ASCII, embedded newline and binary stream
   controls; check PIPESTATUS immediately after successful and failed pipelines,
   pipefail aggregate status, missing inputs, invalid options and failed writes.
   Verify duplicate registration refuses replacement and explicit replacement
   succeeds. Verify cancellation propagates through injected I/O and no new
   invocation-owned effects occur after cooperative cleanup settles.
7. Repeat through MemoryFileSystem and RealFileSystem configured only to the
   owned existing scratch root, including output-directory failure and traversal
   containment. Mount authorized mock S3 and WebDAV adapters and repeat conversion
   bytes, failures and cancellation with injected capabilities. Exercise real
   remote services only if explicit configuration/authorization exists. A mock
   pass does not establish real-service availability; unavailable services remain
   unverified. Never inspect ambient credentials or broaden host roots.
8. Have a different agent independently stress the existing tool and any repairs,
   following the same failing-case requirement. Root retains Git/export ownership.
   Run maintained narrow uncached tests and applicable lint/typecheck gates. Record
   all failures rather than suppressing them. No new screenshot tests: inspect
   actual chart and terminal screenshots for any visible changes.
9. Record measured results and every remaining mismatch below. Do not describe
   unmeasured formats, native parity, services, budgets, replay or isolation as
   verified. Purge only scratch owned by this QA after reduction.

## Visual compatibility procedure (2026-09-21)

Execute this visual audit with owned scratch only at
`out/ssconvert-visual-compatibility-qa`; durable results belong in
`docs/ssconvert/visual-compatibility-verification.md`.

1. Authenticate a fresh official archive and inspect the captured reference
   dependency/plugin/locale profile. Qualify native availability separately;
   retained captures are historical evidence, never a fresh oracle pass.
2. Build the selected Safe Bash dependency closure uncached. Inspect CLI route
   definitions before capturing any poe-code route. For a real forwarding route
   use `npm run screenshot-poe-code -- <route>`; otherwise capture actual public
   Safe Bash Shell/plugin invocations with the maintained terminal screenshot
   utility. Never invent a root ssconvert command. Capture help, importer/exporter
   lists and errors with statuses and separate raw stdout/stderr evidence.
3. Use injected memory byte I/O, C/UTC and explicit limits. Export original small
   graph and workbook fixtures through the actual command. Compare SDK bytes,
   image sizes and PDF page geometry; retain channel and namespace observations.
4. Use isolated QA rendering capabilities to inspect current images and retained
   pinned native images with view_image. Check margins, clipping, fonts, axes,
   labels, orientation, pagination and print settings. Match fixture bytes and
   provenance before claiming a paired comparison. Explicitly identify missing
   fonts, renderers, native services and unsupported graph/print features.
5. This is an audit: make no speculative runtime repair. Any implemented repair
   requires a failing regression first and a different stress/fix agent afterward.
   Reduce observations, command outcomes and artifact hashes into the durable
   report, check Markdown/whitespace, then purge only owned scratch.

## Execution record

### Independent current visual follow-up

Execute with owned scratch `out/ssconvert-visual-current-qa` and reduce results
into `docs/ssconvert/visual-current-verification.md`. Preserve the prior report.
Authenticate fresh source and qualify the currently reachable Colima oracle by
binary, linked-library and font hashes before differential claims. Capture actual
Safe Bash help, lists and negative diagnostics with separate byte channels.
Compare an original graph and portrait/landscape workbook through command/SDK,
XML checkpoint/replay and pinned native output. Render PDFs with isolated
PyMuPDF 1.26.5 and inspect images using view_image. Include rejected print-grid
and missing-object controls with an unchanged destination sentinel. Record every
mismatch and unavailable cell, then purge only this follow-up's owned scratch.
This remains an audit; a repair activates TDD and independent stress/fix gates.

Executed on 2026-09-21. Follow-up results and remaining mismatches are reduced in
`docs/ssconvert/visual-current-verification.md` and
`docs/ssconvert/visual-current-measurements.json`. Fresh native runs used the
separately captured chart profile; the original `/opt` reference remained
unavailable. Eight PDF pages, three graph images and two terminal images were
inspected. No implementation repair was made.

Executed 2026-09-21 on Node 22.22.2. This was an audit of the existing
implementation; no product code, tests, exports, README or Git delivery changed.
No validated runtime repair was made, so the pre-implementation failing-test gate
was not invoked. Independent agent `shell_stress` executed separate adversarial
probes and likewise found no repair to make within the measured shell behavior.

### Inputs and candidate identity

The freshly downloaded official source archive authenticated to the required
SHA-256. Its `src/ssconvert.c` was inspected only in owned scratch. Existing profile
SHA-256: `f5767a61ed1356d95600370135bf3afce808c17aabc0c633d881e14578a8347e`.
It records Gnumeric 1.12.61, GOffice 0.10.61, dependencies, plugin inventories,
locale C, UTC, explicit HOME/XDG roots, memory GSettings and isolated Debian
`a99cfc517144bc59b1978475ec53b46ecabec7e43635402ee5b77cc54cd1b20a`
image digest. The profile remains explicitly incomplete.

Candidate source hashes:

- `packages/ssconvert/src/engine.ts`:
  `5ff85fd43e87d1312def054884d6b69d6d260683b6d7eea5f9fa93fef11706c6`
- `packages/safe-bash/src/commands/ssconvert/index.ts`:
  `986895554efa1a8dca44e664307112c8638562be7080f08b18082f5ceaf1caa4`

QA sessions used built public Safe Bash/domain exports in the same realm, with
explicitly configured codecs `[]`, C/UTC and limits: input/output 1,000,000 bytes,
10,000 cells, 20 sheets, 100,000 operations and 1,000,000 workbook work units.
The original XML workbook described in step 4 was first read by its owning
engine, then written to seed XLSX/ODS fixtures. This respects workbook ownership.
The CSV fixture was exactly `word,value\n"βeta\nline",9\n`.

### Measured example coverage

Each row passed both literal `context.invoke` argv and `sh /case.sh` on both
MemoryFileSystem and the configured real root: 36 successful invocations total.
All had status 0 and empty stderr. Successful file destinations had empty stdout.

| Example           | Measured result                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- | --------------------- | ------ |
| XLSX → CSV        | First sheet, 16 bytes; exact SDK output-file byte equality                                                         |
| ODS → fd stdout   | `alpha\n\n\n\n\n\n\n\n\n9\n`; exporter explicitly selected                                                         |
| CSV stdin → XLSX  | Direct injected stdin and actual `cat` pipeline succeeded; readback retained `βeta\nline` and numeric 9            |
| Cell set/recalc   | A11 became 10; 19-byte CSV exactly matched SDK `updateExpressions`/`recalc`                                        |
| Split             | Only `out-0-First.csv` and `out-1-Second.csv`; respectively 16 and 6 bytes, exact SDK artifact-byte equality       |
| Merge             | Published `combined.ods`; exact SDK merge-byte equality; readback names `First`, `Second`, `First(2)`, `Second(2)` |
| Graph PNG         | Only `chart-0.png`, 20,118 bytes; PNG signature and exact SDK graph-byte equality                                  |
| `-O sheet=Second` | Exactly `βeta\n`; exact SDK stream-byte equality                                                                   |
| Configured text   | Real-root CSV exported with `separator='                                                                           | ' eol=WINDOWS charset=UTF-8`: exactly `word | value\r\n"βeta\nline" | 9\r\n` |

Scripts assigned `cmd=ssconvert`, invoked `"$cmd"`, quoted every operand and
preserved the `--set` equals sign, percent templates and nested option quotes.
Independent VFS script also used a quoted variable filename containing spaces
and exercised CSV → XLSX → CSV with exact UTF-8 output.

The graph fixture was an original empty GogGraph with 72×36-point bounds.
The memory fixture additionally had an explicit solid `12:34:56:FF` background.
Its generated PNG was viewed: a uniform dark blue 100×50 image, as expected for
that fixture. This qualifies background/bounds output, not plotted series.
Actual negative-command output was rendered with maintained `terminal-png` and
visually inspected; diagnostics and status lines were readable without clipping.

### Shell, effects and failure controls

- CSV → XLSX fd stdout → `cat > binary.xlsx` retained workbook contents;
  immediate `PIPESTATUS` was `0 0 0`. Independent matching-filename SDK output
  compared equal to all 4,066 binary pipeline bytes.
- Missing-input `cat` followed by ssconvert produced `PIPESTATUS` `1 0` and
  aggregate 0; `pipefail` returned 1. An empty-stream conversion can still create
  `failed.xlsx`; upstream failure does not roll back downstream namespace effects.
- Missing ssconvert input returned 1 and exactly
  `E /missing.xlsx: No such file or directory\n`.
- Unknown option returned 1 and exactly
  `Unknown option --bad\nRun 'ssconvert --help' to see a full list of available command line options.\n`.
- Missing output directory returned 1 and exactly
  `E Can't open 'file:///missing/out.csv' for writing: /missing/.gsf-save-000000: No such file or directory\n`.
- Independent injected EACCES write returned 1; diagnostic retained the temporary
  path and `Permission denied`. Input stayed intact and destination absent.
- Duplicate plugin registration rejected with
  `Command already registered: ssconvert`. Explicit `replace: true` then passed
  registration and conversion with exact Unicode stdout `x\n雪\n`.
- Independent cooperative read cancellation retained caller reason
  `stress cancellation`, destination absent.
- An injected cooperative write-stream wrapper over the configured real adapter
  was cancelled after write admission. Shell rejected `real write cancelled`;
  `cancelled.csv` remained absent after settlement and disposal. This measures
  injection/cancellation propagation, not interruption of a native OS syscall.
- `/../../outside.csv` normalized to `/outside.csv` inside the configured root.
  Host stat verified that file inside the root and absence at the corresponding
  outside path. The sentinel remained `untouched`. General symlink/race isolation
  was not inferred from this lexical-path control.

### Mounted adapters and remaining mismatches

Explicitly mounted mock S3 and injected MockDav WebDAV adapters both passed
Unicode CSV read → stdout and `cat` → ssconvert → memory-root XLSX workflows.
Both also passed a VFS `.sh` file using a quoted mounted-input variable, a
CSV → XLSX pipeline and XLSX → stdout readback, exactly `word,value\n雪,7\n`.
No real network requests or ambient credentials were used.

Both remote command destinations returned 1 with exactly:

```text
Filesystem exclusive creation, atomic rename, unlink and permissions capabilities are required for ssconvert file publication
```

The guard is in `packages/ssconvert/src/io/publication.ts`; the mocks do not
supply the required publication contract. Remote command writes are therefore
unsupported in this measured configuration, not passes. No safety capabilities
were fabricated and no publication guard was weakened as an audit repair.

Independent mounted S3 read cancellation admitted one GET with `abortSignal`,
retained caller reason `mounted S3 read cancelled`, preserved input and left the
local destination absent. Direct mounted-adapter PUT cancellation returned typed
ECANCELED with mounted path and underlying `putObject` cause; output absent.
That adapter control is not ssconvert shell-write coverage: shell fd redirection
refused before PUT with status 1 and exactly
`shell: line 1: ENOTSUP: operation not supported, appendFile '/s3/output.csv'\n`.
Injected WebDAV request cancellation also passed through the mounted ssconvert
read workflow: fetch received its signal and shell retained exact caller reason
`mounted WebDAV read cancelled`. Remote ssconvert publication cancellation remains
unverified. No deployed S3/WebDAV endpoint/configuration was supplied; their
availability, authenticated workflows and failed service writes remain unverified.

The initial merge readback with the explicitly configured 1,000,000-unit work
limit rejected `ssconvert OpenDocument work limit exceeded`. A separate readback
using the existing 10,000,000-unit default succeeded with four sheets. These are
separate budget profiles; the bounded failure is retained and not called a pass.

Fresh native oracle comparisons remain unverified. The existing running
`ssconvert-statistics-qa` container lacked `/opt/ssconvert-reference/bin/ssconvert`
and a PATH ssconvert; it was not changed or removed. Historical profile captures
do not prove fresh native status/diagnostic/file equality for these examples.
No product native dependency, host-shell fallback or oracle execution inside the
virtual shell was introduced. Complete Gnumeric parity, arbitrary options,
plotted graphs, replay, resource retirement, budgets and other versions remain
outside measured coverage.

Probe corrections retained: arbitrary caller workbook objects are rejected by
engine ownership; read the seed into its owning engine. `createRealFileSystem`
requires awaiting acquisition. `createResourceIO` requires explicit cwd. fd stdout
requires an exporter. SDK filenames must match shell filenames for binary
metadata equality. These incorrect probe setups were corrected without product
changes and are not attributed to product regressions.

### Fresh checks and cleanup

- Uncached selected Safe Bash workspace build/dependency closure: passed.
- `npm test --workspace=@poe-code/ssconvert`: passed, 317 files / 6,275 tests;
  fresh Vitest execution without shared machine-cache substitution.
- Focused actual-shell Node/tsx tests, `packages/safe-bash/tests/commands/ssconvert*.test.ts`:
  118 passed, zero failures/skips/cancellations, 13.13 seconds. This was the
  maintained Node/tsx test mechanism with explicit file selection, not a claim
  that every Safe Bash workspace test passed.
- `npm run lint --workspace=@poe-code/ssconvert`: passed, including source lint,
  source/test/consumer TypeScript checks.
- Maintained Safe Bash typecheck: **failed**, status 2, preflight:
  `Public SafeFS must preserve shared SafeJS runtime identity`; actual undefined,
  expected `./packages/safe-js/dist/safe-fs.js`. Zero builds, consumer groups and
  runtime executions occurred. It is not a passing typecheck. This integration
  gate was recorded, not speculatively modified during the scoped audit.
- The attempted Safe Bash npm test with `SAFE_BASH_TEST_RG` discovered all 1,347
  files: that variable is not a maintained package-runner selector. Only this
  owned overly broad invocation was stopped, then the explicit focused test
  mechanism above ran. The stopped invocation is not a pass or full-suite result.
- Markdown formatting checked with Prettier. Temporary logs, source download,
  generated workbooks and inspected images were reduced into this execution
  record, then only owned scratch/logs were purged. No commit, push or release.

## Fresh candidate re-execution procedure

Repeat the procedure above against the current checkout, preserving the earlier
execution record. Use only new owned scratch `out/ssconvert-shell-workflows-fresh`.
Before changing implementation, retain a failing original regression; an audit
without a validated repair must not invent one. Independently check the exact
candidate with a second agent. Fresh source acquisition, hash authentication,
public-export build closure, direct invocation, VFS scripts, SDK byte comparison,
real-root containment, failure cleanup, mounted mock controls and cancellation
are separate cells. Deployed remote services and a runnable qualified native
oracle require supplied capabilities; report unavailable cells as unverified.
Record each actual gate outcome and candidate hashes below; keep prior outcomes
historical. Do not treat focused tests as completion of broader gates.

## Fresh execution observations (2026-09-21)

Candidate checkout HEAD was `b97c4938a469ee70e09bd08a0e5fcf7e868ca04c`,
with existing unstaged/untracked work preserved. Original candidate source
inventory (sorted paths, path + NUL + bytes + NUL over ssconvert/src and the
command directory): 596 files, SHA-256
`8801d09ad792a96f4a10977efe654399469c6e49b3ccbbd424fdf3a14d32e097`.
Source engine and command hashes matched the earlier record. Built engine hash
was `ed73dec73dcbdc2710787279d18d97c156412b6777bc25c07a0bfe0be8a625f8`.
The fresh official source download authenticated to the required archive hash;
`src/ssconvert.c` was inspected in owned out scratch. Captured reference profile
hash remained `f5767a61ed1356d95600370135bf3afce808c17aabc0c633d881e14578a8347e`.
Docker API is unavailable and the discovered reference executable is Linux ELF
on this macOS host. No fresh native oracle process ran; historical profile
capture is not fresh differential verification.

### Fresh deterministic coverage before repair

Inline agent sessions used built public exports in one realm, `standardCommands`,
the actual opt-in ssconvert plugin, and literal `context.invoke` argv. The nine
procedure examples each passed direct argv and VFS `sh /case.sh` on memory and
an explicitly configured existing real root: 36 successful invocations. The
original two-sheet/empty-graph XML and Unicode multiline CSV from the procedure
were used. Limits were input/output 1,000,000 bytes, 10,000 cells, 20 sheets,
100,000 operations and 10,000,000 workbook work units, C/UTC.

The merge command correctly emitted ordered stderr:
`Adding sheets from file:///one.xlsx\nAdding sheets from file:///two.xlsx\n`.
Fresh merge readback retained First, Second, First(2), Second(2). Set/recalc
produced A11=10. Sheet selection returned `βeta\n`. Configured text returned
`word|value\r\n"βeta\nline"|9\r\n`. Binary CSV→XLSX→cat pipeline readback retained
multiline Unicode cells and PIPESTATUS `0 0 0`. Missing upstream input with
pipefail gave aggregate 1 and vector `1 0`; downstream failed.xlsx existed.
SDK CSV bytes matched shell output.csv exactly. Missing input, unknown option
and missing output directory returned status 1 with the diagnostics in the
earlier record. Sentinel remained intact. Traversal normalized inside the real
root; owned file existed inside and corresponding outside path was absent.
This is lexical containment, not general symlink/race or realm isolation proof.

Duplicate registration was verified by calling plugin.setup on the actual shell;
it rejected collision, then explicit replacement succeeded. Shell.use schedules
plugin setup, so expecting a synchronous exception from use itself was an
incorrect probe. Other investigated probe mistakes were passing a command array
to use, omitting cat registration, and assuming successful merge had empty
stderr. Corrected runs completed; failed probe runs are not counted as passes.

The generated empty graph PNG and actual terminal diagnostic screenshot were
visually inspected. The graph is a small blank/black image, consistent with the
empty graph fixture; plotted series remain unverified. Terminal diagnostics and
status lines are readable without clipping. No screenshot tests or QA TS script
were added.

### Validated cleanup defect

A cooperative real-root data writeStream was admitted, then cancelled with a
caller reason object. Exec preserved reason identity and dispose settled, but
zero-byte `.gsf-save-000000` remained, including after a 50ms observation. No
underlying unlink was called. Independent agent reproduced this with a memfs
original CSV fixture and an actual MemoryFileSystem namespace in
`tests/commands/ssconvert-cancellation-stress.test.ts`. Its first regression run
failed before implementation. Input and destination sentinel were preserved;
private staging cleanup failed. The invocation-scoped filesystem refuses normal
unlink after cancellation; cleanup needs the retained cleanup capability.

### Independent boundary controls

Independent agent verified opaque bytes `00ff800d0a002227245cc3a9`, quoting and
expansion, VFS scripts, PIPESTATUS `[7,0]`, default aggregate 0 and pipefail 7,
SDK parity, unknown exporter/missing input sentinel preservation, preaborted
caller reason identity, input/output 11-vs-12 byte negative budgets and argument
budget refusal. Its initial opaque-codec cancellation pass did not cover the
later validated CSV publication cleanup defect.

Mounted MockS3 and injected WebDAV fetch passed byte reads (`00ff800a`) and
admitted read cancellation with caller reason identity and no local output/temp.
S3 publication refused the required capability contract before any PUT. WebDAV
publication returned status 1 with `E Can't open 'file:///dav/out.opaque' for
writing: /dav/out.opaque: Operation not supported\n`, with zero PUT effects.
These are unsupported publication cells. Deployed remote services, authenticated
service writes and remote publication cancellation remain unverified.
Independent harness failures (inconsistent mock namespace, wrong S3 getObject
hook instead of getObjectStream, wrong signal key, DAV root marked as file) were
investigated and corrected; the unsettled-await S3 run is not a pass.

### Initial fresh gate results

- Maintained selected uncached build closure: passed (18 builds; postbuild ran).
- `npm test --workspace=@poe-code/ssconvert`: 317 files, 6,275 tests passed fresh.
- `npm run lint --workspace=@poe-code/ssconvert`: passed all declared stages.
- Focused Node/tsx ssconvert shell tests: 118 passed, no skips/cancellations.
- Selected maintained integration discovery/inventory tests: 30 passed.
- Safe Bash typecheck failed before any build/consumer/runtime group. Investigation
  traced it to qualified-current-release/peer.mjs requiring root ./safe-fs.import
  to be ./packages/safe-js/dist/safe-fs.js; current root has no ./safe-fs export.
  Existing root metadata edits are preserved. This gate is blocked, not passed;
  no receipt rewrite or weaker identity assertion was introduced.

Original/checkpoint/replay, upstream variants, arbitrary budgets, workerd/browser
and foreign-realm boundary matrices were not freshly measured by these manual
sessions. Package tests cover additional cases, but no complete compatibility
claim is made. No bounded performance benchmark was run; test durations are gate
durations only. Full repository unit/test/type/build gates are not represented
by the selected workspace/focused gates.

### Repair and final candidate verification

Independent agent `shell_stress` implemented the validated repair after its
failing regression: domain `createVfsOutput` accepts an optional injected cleanup
retainer, enrolls the retained abort before acquisition, and preserves ordinary
SDK cleanup by default. The shell binding injects `retainFileSystemCleanup` with
one permitted removal operation per publication. Cleanup uses the retained
nonrecursive removal view after cancellation instead of cancelled scoped unlink.
The engine remains shared; no native fallback or new root export was introduced.
Root added the exact regression path to maintained integration discovery
assertions, preserving existing edits in that file.

Final source inventory has 596 files and SHA-256
`7eae3ea46722f309bd52fa27fd9aee0b51aac9bca07ae2590cfdef586925e1c5`.
Changed candidate file hashes:

- Command source: `3be28170b5f60a9697876f87c865f7363b68e15c3fa0b0ce2ebde91f9b3983d5`.
- Domain publication source: `b20d7cab60cacba3e8081fb6309137e4977bd289681a90798bcd7d64c8aed836`.
- Regression: `8aa20ceb2d6c83aaa0f6363abe1a31b1447a3a72a92f7bdba30f12c5f26f8c41`.
- Built command: `b831e7617095fea7d0a50c205328c4859a0afcd7eb05c693a174fa8a74fe25f8`.

Root independently reran the original real-root admitted data-write cancellation
against rebuilt public exports: caller reason identity, exec/dispose settlement
and exact pre-invocation namespace all passed; owned private temp was removed.
The independent agent then stress-tested VFS-script publication, EACCES failure
and cancellation with a foreign `.gsf-save-000000` collision sentinel. The owned
000001 temp was removed, foreign 000000 contents and original input/destination
were untouched. This verifies a concrete negative authority control, not general
concurrent filesystem-race safety.

A separate final session completed all nine examples on both memory and real
adapters through literal argv and VFS scripts, plus independently mapped SDK
convert/merge requests. Both stdout/stderr bytes matched direct vs script, and
every successful stream/artifact byte array matched SDK output. The stdin example
used direct injected bytes and actual cat pipeline; its SDK used descriptor 0.
The final comparison initially treated an artifact file URI as a VFS path;
that probe failed ENOENT, was corrected by decoding the URI path, and the whole
comparison completed. No product repair was made for that probe mistake.

Original conversion and Gnumeric XML checkpoint → VFS script replay also matched
exact set/recalc CSV bytes on memory and real-root adapters. Final real-root
binary pipeline retained UTF-8 multiline content and vector `0 0 0`. An extra
memory pipeline in that session lacked its CSV seed and was not asserted or
counted as a pass; memory binary pipeline coverage is from the earlier fully
seeded session. Foreign-realm, host authority races, runtime variants and full
resource/performance matrices remain unverified.

Final maintained checks after repair:

- Selected Safe Bash uncached build closure and postbuild: passed.
- Fresh domain workspace test route: 317 files / 6,275 tests passed.
- Focused actual-shell ssconvert tests: 119 passed, zero failures/skips/cancellations.
- Domain workspace lint/source/test/consumer typechecks: passed (independent agent).
- Integration discovery/inventory selected tests: 30 passed.
- Safe Bash typecheck rerun: failed status 2 at the same identity preflight, zero
  consumer/runtime checks; root export metadata mismatch remains unresolved.
- Repository ESLint first execution: passed, zero errors/four warnings (zip tests).
  A second execution was started after source stabilized to qualify the exact
  final candidate; its result is recorded below when complete.

An attempted independent root unit-runner invocation with a workspace selector
was rejected as unsupported before tests ran; it is not a broad unit gate or a
unit-test failure. Full npm test, root build, repository-wide type lint, deployed
services and fresh native differential comparisons were not completed. Selected
workspace build/tests and repository ESLint are recorded separately, never as a
completed full gate. No unit test spawned native utilities, queried LLMs or wrote
files. No README edit, staging, commit, push, publication or issue closure occurred.

Final stabilized-candidate repository ESLint rerun completed successfully: exit 0,
zero errors and four warnings; all 17,054 configured subjects linted through the
maintained guarded route. Markdown formatting and Git whitespace checks passed.
Only this run's owned out/ssconvert-shell-workflows-fresh scratch was purged after
reducing evidence into this record. Earlier out scratch and unrelated changes
were preserved. Delivery remains local working-tree edits only: no local commit,
remote-main delivery or release.
