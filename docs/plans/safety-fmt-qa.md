# fmt resource and failure boundary QA

Qualify the current working tree; preserve unrelated edits. The package pattern
is at `docs/plans/archive/safe-bash-command-package-pattern.md` in this tree.

1. Run private fmt unit/lint routes and independent Shell fmt/adversarial,
   boundary and aggregate-registration tests. Check exact bytes, chunk reuse,
   cancellation, backpressure, single retirement, quota diagnostics and disposal.
2. Reproduce closing a canceled unstarted DeviceFS reader with a backing VFS that refuses
   acquisition. Cancellation closes admission: close must not acquire. Preserve normal owned unread-stream retirement and drain started/reentrant acquisitions.
   Run all maintained device-stream/acquisition fixtures after the fix.
3. Check real VFS `.sh` execution, pipelines and typed SDK redirects. Check source
   aliases and partial output explicitly. `set -o noclobber` is unsupported:
   guard dependent publication with `&&`; ordinary redirects are non-atomic and
   can truncate the source. Do not claim conditional/exclusive guarantees.
4. Check missing host credential paths, URL operands and unregistered host
   executable/network commands using only MemoryFileSystem in unit fixtures.
   These are negative VFS/dispatch controls, not a hostile-JavaScript sandbox.
5. Verify released archive SHA256 and compare pinned development `src/fmt.c`.
   Read the released source, manual and all five upstream tests. Keep historical
   8.30 fixtures under their explicit profile. Do not execute a native fmt.
6. Because the fix touches shared SafeFS, complete `npm test -- --no-cache`,
   `npm run lint`, and `npm run build`; retain each gate's independent status.
7. Stage public Safe packages, pack/install public tarballs into an isolated
   consumer; run fmt runtime and strict NodeNext declaration fixtures. Inspect
   Shell-dispatched help and width8 output in a CLI screenshot. No publication.

## Initial findings

The new unstarted-reader fixture failed before the fix: `return()` queried/opened
the backing filesystem. Actual Shell fmt with work0 or retention1 first emitted
its limit diagnostic, then rejected with cleanup-generated EPIPE. Direct SDK
execution returned status1. DeviceFS deferred acquisition is now recorded before
calling the opener; canceled close before first next creates no acquisition.
Closing after admission still waits for the acquired iterator. Non-canceled
close preserves the existing owned unread-stream retirement contract.

Ordinary same-path and symlink-alias redirects truncate input before fmt reads.
Output quota1500 with input A^10001 + SPACE end leaves a nonempty A-only prefix
of at most1500 bytes in the redirected destination. Neither behavior supplies
atomic replacement or rollback. Conditional/exclusive Shell publication remains
unsupported, an acceptance limitation rather than a passing guarantee.

Initial test-authoring failures also included treating readdir entries as strings
and expecting unsupported noclobber to succeed. Those assumptions were corrected
against the actual contracts; the original failed run is not a passing gate.

Temporary evidence uses ignored `out/safety-fmt`: creating `/out/safety-fmt`
failed because the host root filesystem is read-only. Purge task-owned output
after recording final receipts.

## Verification receipts (2026-09-19)

- Private fmt: 65 unit tests, workspace ESLint and source/test typechecks passed.
- Device stream/acquisition: 36 tests passed; the original unstarted-reader
  regression failed before the fix. Reentrant and falsey cancellation controls
  still pass. The broad gate exposed that unconditional no-acquisition close
  violated existing owned unread-stream retirement; the final guard is limited
  to cancellation before admission. The older stream test is preserved unchanged.
- Fresh fmt/adversarial/boundary/aggregate selection: 765 passed, no failures,
  skips or cancellations. The ten new boundary cases use memory VFS only.
- Selected maintained Safe Bash build closure: 18 builds passed. Full
  `npm run build` subsequently passed including root suffix stages.
- Focused changed-file ESLint and repository `lint:packages` passed.
- Full `npm run lint` passed: ESLint zero errors/four warnings, all16,096
  configured subjects processed with zero cache hits; maintained typecheck and
  workflow routes passed. `git diff --check` passed.
- Three private export-condition qualification tests passed; these reject
  unprepared exports and are not actual browser/workerd execution cells.
- Manual screenshot runner completed; inspected actual Shell help and width8
  output. Help is legible; output is `aa bb cc LF dd ee LF`.
- Released archive authenticated against the supplied SHA256. Read full fmt.c,
  fmt's Texinfo section and base.pl/goal-option.sh/long-line.sh/non-space.sh/
  width.sh. The pinned development fmt.c changes only initialization placement.
  No native formatter or host locale was executed. Existing tests separately
  exercise released goal/long-line/width and byte-space controls; historical
  8.30 snapshots remain explicitly historical.
- Public-only tarballs installed offline with scripts disabled into an isolated
  consumer outside the checkout. Maintained fmt runtime and strict NodeNext
  declaration fixtures passed, including realm-owned Uint8Array input,
  canonical runtime identity, byte argv, SDK, `.sh` and pipelines. Private fmt
  and contracts packages were absent. Consumer removed after use.

Tarball SHA256 for local version `0.0.0-safety-fmt`:

| Package | SHA256 |
| --- | --- |
| SafeFS | `44012552b956ffe1a34c8086bc910f62e045152134983d80d00672b1ba730e82` |
| SafeJS | `e7cf1c47040b819d4c45369ab0fdde034441433b836ef5187bfe10ba1e2ca201` |
| SafeBash | `9588e09064c37038d744bc4db5885d4894e0bd61c3a18178d4329a07d212ff6c` |

The first broad `npm test -- --no-cache` failed before units during a prerequisite
tiny-mcp-client bundle: toolcraft-schema's dist was unavailable while a concurrent
full build rebuilt it. This execution remains failed, not a completed unit gate.
The complete route was restarted after full build settled; its result is recorded
separately below. No implementation was changed for this invocation collision.

That sequential broad run failed in Safe Bash: 41,897 passed, 829 skipped,
three failed. The failures were unread redirect retirement, cleanup-triggered
abort and partial/zero/failed redirect consumption. Each depended on preserving
the existing non-canceled owned unread-stream close contract. The unconditional
no-acquisition close change caused them. The final guard skips acquisition only
when cancellation has already closed admission and no opener has started;
normal unread-stream cleanup remains unchanged. All36 device controls pass.
An initial direct Shell rerun still loaded the previous SafeFS dist and failed;
fresh maintained build artifacts are required before integration qualification.
The prior full build/lint and tarballs above qualify the initial candidate,
not the final revised guard. The final gates run build, lint and uncached units
in sequence and have their own receipt below; no focused rerun replaces them.

Candidate identity: dirty working tree based on Git HEAD
`35d01c57f8078d8afa916dc59929395d857e9c55` (this receipt is not a frozen
committed-candidate gate). Shared edited code SHA256 is recorded in the final receipt below;
new Shell boundary tests
`ee9053f476c55311567588dae47008932afa77eed9bd72f76fa1e3277b98b96c`.
Fmt command and engine code were preserved: respective SHA256
`3378b58934ae6901e2c67232c0a9a30a3c50ca1a238b98ce56cd15ea00094a6d`
and `7f50a2094b86643a00b57c25951720355c5700defa11dfaaf6e309b655ea13de`.

Unavailable/unverified: actual browser/workerd/Bun engines, full released native
matrix transcripts and remaining prefix/margin/punctuation/tie/window
combinations. ISO-8859-1 and KOI8-R locale variants in upstream non-space.sh are
unsupported explicit profiles, not passes. No bounded performance/RSS claim is
made. Original/checkpoint/replay interpreter paths were not changed or separately
requalified. Conditional/exclusive Shell publication is unsupported; acceptance
of that requested guarantee remains open.

Local commits: none. Verified remote-main delivery: none. Successful releases:
none. No command package was published.

## Final revised candidate receipt (completed 2026-09-20)

- `npm run build` passed: maintained resolver reports 85 workspaces, 84
  declared builds and 236 edges; root suffix stages completed. The workspace
  without a declared build is not a passing build cell.
- `npm run lint` passed, including maintained TypeScript/header contract and
  workflow routes. Guarded ESLint processed all16,096 configured subjects:
  zero errors, four warnings, complete receipt and exit0.
- Fresh Safe Bash cleanup/lifecycle/language/fmt selection: 276 passed,
  no failures or skips. Final DeviceFS selection: 36 passed.
- Independent read-only reviewer: 11 additional memory-mock cases passed with
  source imports (falsey cancellation, unread ownership, deferred acquisition,
  synchronous admission failure and reentrant close); no further defect found.
  Negative VFS/dispatch controls do not independently instrument ambient
  credentials or network calls, and do not establish hostile-JavaScript isolation.
- Final public-only staging/version `0.0.0-safety-fmt-final`, offline install
  with lifecycle scripts disabled, installed runtime fixture and strict NodeNext
  declaration fixture passed. Unpublished fmt/contracts packages were absent;
  isolated consumer removed.

| Final artifact | SHA256 |
| --- | --- |
| SafeFS | `7e5b0db83d232f3330b4fb0ab8dfdf9fb175950dd2cba715313c13c39695d171` |
| SafeJS | `d968a7534075d16ac7533f442211ce9ffdb75d61ce20842299f67a370f1dbe0e` |
| SafeBash | `47df75696019ee6618c5ffcf62a88fbbb24c9f8c22e744fa8e6e015e9913a939` |

Final shared code SHA256:
`f3ca8fc19e925b444b8ffd8933362eb3e6ec26d2f0f82896d74ae1195c29d6c5`;
new DeviceFS test SHA256:
`0fb998fbcb3f8a67664a855d7dbc2defa71f3011ebd2f7ea7f911c33b7c9f951`.

Final `npm test -- --no-cache` **passed**, process exit0, including root
posttest. The maintained resolver selected 53 declared unit tasks and 33 required
build tasks across 85 workspaces, concurrency1, no exclusions, UNCACHED.
Its 33 workspaces without declared tests (including SafeFS) are not passing unit
cells; SafeFS device coverage is the separate36-test selection above.

- Shared Vitest: 1,698 files, 45,242 passed tests, two skipped tests.
- Safe Bash: 41,900 passed, zero failures/cancellations, 829 skipped
  (42,729 total), duration 1,152,072ms. The earlier three cleanup failures
  pass in this complete suite.
- SafeJS: 1,467 passed files/three skipped; 31,121 passed tests/48 skipped.
- Safe Playwright: 34 passed. Safe Python: 1,151 files/84,595 tests passed.
  Terminal Pilot: nine files/293 tests passed.
- Root posttest lint-stress: both tests passed.

All final task-owned source/test hashes were rechecked unchanged, HEAD remains
`35d01c57f8078d8afa916dc59929395d857e9c55`, and `git diff --check` passed.
Initial failed/incomplete gates above remain failed/incomplete historical attempts;
this successful full execution is a separate final gate. Unavailable comparator
plugin cell remains pending, and the explicit runtime/profile/publication
limitations above remain open. No failure or timeout remains unresolved in the
final maintained route. Task-owned ignored evidence is purged after this receipt.
No local commit, remote-main delivery, release or publication occurred.

### Manual instrumented authority check

Executed in a separate Node process after importing the current source modules:
create MemoryFileSystem `/input` containing `aa bb cc dd ee`, construct Shell
with explicit `{ LC_ALL: 'C' }` and fmt-only registry, and register the typed SDK
command. Replace monitored Node fs reads/opens/streams/writes (sync, callback and
promise variants), child_process spawn/exec/execFile/fork variants, HTTP(S)
request/get, net connect/createConnection and global fetch with throwing counters;
synchronize builtin ESM exports. Proxy `process.env` to deny reads of
AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY/AWS_SESSION_TOKEN/OPENAI_API_KEY/
ANTHROPIC_API_KEY.

Both `fmt -w8 /input` and `fmt-sdk` returned status0, empty stderr and exact
`aa bb cc LF dd ee LF`. Host credential paths and URL operands returned
status1/ENOENT; `/usr/bin/fmt` and curl returned127. Disposal completed. All
monitored authority counters remained zero. The process environment was restored
and the process exited successfully. This augments, rather than relabels, the
unit VFS/dispatch controls: it covers these monitored APIs/credential names and
fixtures after module loading, not all host capabilities, loader isolation,
all credential mechanisms or malicious JavaScript.
