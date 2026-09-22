# fmt independent compatibility qualification

## Manual QA procedure

1. Authenticate released coreutils 9.10 archive against SHA256
   `16535a9adf0b10037364e2d612aad3d9f4eca3a344949ced74d12faf4bd51d25`.
   Build only its fmt executable as a manual control. Read released fmt.c,
   the fmt manual section and all upstream fmt tests; compare development
   source `b25722854370b8206d7f53f8934c36710cdd9974` separately.
2. Execute deterministic original fixtures, MAXCHARS and MAXWORDS matrices,
   combined punctuation/margin/window controls and invalid options with explicit
   C and en_US.UTF-8 environments. Capture exact input, argv, stdout, stderr and
   status. Native control processes are manual QA only, never unit dependencies.
3. Compare candidate engine bytes with captured controls at chunk sizes 1, 37
   and 4096; minimize differences before adding failing memory-only regressions
   and repairing validated defects. Record effects and candidate source identity.
4. Run maintained command workspace unit/lint, selected Safe Bash build closure,
   fmt Shell/SDK integration and export-condition checks. Inspect an actual Shell
   wrapping screenshot through the maintained screenshot route.
5. Record unavailable runtimes, upstream variants and replay cells explicitly.
   Keep performance measurements separate. Purge task-owned temporary evidence
   after recording durable fixtures and receipts. Preserve unrelated edits.

Temporary evidence uses ignored `out/compatibility-fmt`: previous QA establishes
that host `/out` is read-only. No publication, push or release is requested.

## Executed receipt, 2026-09-20

Candidate HEAD `35d01c57f8078d8afa916dc59929395d857e9c55` has existing
uncommitted fmt/package integration. HEAD alone does not identify this candidate.
Production source SHA256 is
`be1672fa4989c2aa103b2b75c88e9b5b96c2711e73c4cce268260ab34584e886`:
sort non-test `.ts` paths under `packages/safe-bash-command-fmt/src`, hash each
repository-relative path, NUL, then complete file bytes. No production source,
manifest, facade, shared builder or registration changed in this task. Added
only static manual-control transcripts, memory-only tests and this receipt.

Tools: Node v22.22.2, npm 10.9.7, TypeScript 5.9.3; Darwin arm64,
Apple clang 17.0.0 (`clang-1700.0.13.5`), target arm64-apple-darwin24.6.0.
Authenticated archive matches the SHA256 in step 1. Built executable identifies
itself as `fmt (GNU coreutils) 9.10`, SHA256
`abf577bc04df3eba39a46da1650f75698ea89699e868d465cde7983514186747`.
Configuration: `./configure --disable-nls --disable-dependency-tracking`;
generate `$(BUILT_SOURCES)` before `make src/fmt`. Initial direct target build
failed for missing generated `uchar.h`; the completed build resolved it.
Native controls use explicit `PATH=/usr/bin:/bin`, `LC_ALL=C` or
`LC_ALL=en_US.UTF-8`, argv[0] `fmt`, 3-second process deadline and 32 MiB output
capture bound. Explicit UTF-8 locale charmap verified as UTF-8. Candidate uses
`gnu-coreutils-9.10-C-bytes`; formatting never relies on a host decoder/width.
No BSD fmt or older GNU runtime is used as the baseline.

Read released fmt.c, corresponding manual section and all five upstream fmt
tests. Compared development fmt.c, manual section and those test files at the
specified snapshot. Source initialization moved into declarations; formatting
algorithm unchanged. Development base.pl stops normalizing range errors and
checks platform ERANGE text explicitly. These are source findings, separate
from the freshly executed native observations below.

### Exact controls and byte evidence

Both gzip JSON archives under `packages/safe-bash-command-fmt/fixtures` contain
complete inputs, argv, explicit locale, base64 stdout/stderr and status. Inputs
are UTF-8 strings, except `inputBase64` explicitly owns opaque byte cases.
`portableStderr` records a separately identified candidate diagnostic policy;
it never replaces native `stderr`. Gzip is evidence compression, not a runtime
dependency. No test downloads fixtures, spawns controls or creates files.

- `released-9.10.json.gz`: 706 controls; SHA256
  `41cb38d96afb4fa70127b32b395d41080a8bb9e4485f9b18a06f1806060e3bd4`.
- `released-9.10-large-output.json.gz`: 24 controls, manual QA only; SHA256
  `ebc239106f67d8d7c6f0e9e0cb9d9ec514c8a27a2d301d89d2124addfc19662c`.
- `src/released-controls.test.ts`: SHA256
  `de0976a768f0e6a33c899caee6a5410f9fb2a6e7646481a546c06ab513afdedd`.

New original cohort: 18 exact inputs in the archive, covering email quotes,
bullets, tabs, sentence spacing/closers, long words, empty input/lines, Unicode
words/blanks, indentation, unmatched prefixes and VT/FF/CR. Seven modes are
`-w20`, plus respectively `-u`, `-c`, `-t`, `-s`, `-p '> '`, or `-c -t -s -u`.
Both locales: 252 cells. This is a newly authored cohort, not a claim to recover
the task's unnamed original 18 inputs.

MAXCHARS: the exact supplied ten lengths × five leading profiles × four modes,
all `-w20`, prefix `> ` where applicable, no final input LF: 200 C cells.
MAXWORDS: supplied twelve counts × widths 7/17/20/75 × recipes all-a,
alternating a/bb and cyclic a/bb./c, single spaces and final LF: 144 C cells.
All complete byte outputs retained; no line-count summary substitutes for them.

Combined controls: counts 997/998/999/1000/1999 × leading empty/TAB/`> `/`  > `
× modes crown/tagged/split/uniform, width20. First line cycles
`a.)"`, `bb.`, `(c`, `d!`, `e,`, separated by two ASCII spaces; second line is
leading profile plus `tail end`, without final LF. Prefix option applies to
quoted profiles. All 80 C cells completed. Initial 1 MiB capture exhausted in
20 cells; repeating the entire cohort with the documented 32 MiB bound resolved
all incomplete captures. These were capture-limit failures, not timeouts or
formatter differences. Twenty-four outputs exceed the routine unit-fixture
size allowance; the largest is 13,720,694 bytes. Full captured bytes remain in
the separate archive and were compared to candidate output at input chunks4096.

Twelve C numeric controls cover width0/1/2, goal0/20, +5/05/leading-space5,
legacy -20/-123, unique --wid and repeated goals. Ten C negative controls cover
goal76, goal20/width10 in both orders, width2501, legacy suffix/later legacy,
unknown option, missing long/short argument and forbidden option argument.
Native invalid invocations produce empty stdout/status1; candidate does likewise
and acquires neither stdin nor file authority.

Mapped upstream controls: width7/8, 8-bit prefix, unmatched/prefix-only/strict
prefix, exact goal-option document and 1015-word split long-line, plus all five
UTF-8 non-space variants: 26 cells across the two locales. Six further controls
cover ff SPACE SPACE fe, NUL/invalid-byte words and embedded NUL under `-u -w5`.
ISO-8859-1/KOI8-R non-space variants and upstream Perl file/pipe harnesses were
not executed; these mappings are not counted as full upstream harness runs.
Missing-file semantics are covered by existing VFS tests, not a fresh native
file comparison. No random fixture generation or performance benchmark was used.

Totals: 730 completed native observations, 720 status0/empty-stderr formatting
cells and ten status1 negative cells. Candidate stdout matched every successful
control byte-for-byte. Routine memory-only tests compare all 696 small successful
controls with input chunk sizes1/37/4096 and assert released retained storage.
Original and negative cells also compare CLI/SDK status/output/error bytes,
await sink writes and deny all file authority through a throwing capability.
Native processes read only explicitly supplied stdin and return captured output;
no files are supplied or written by fmt. Shell redirect effects are separately
covered by the existing memory VFS boundary tests.

### Diagnostic differences and qualification limits

Four negative native stderr values differ from the explicit portable candidate
policy. Minimized triggers are `-g76`, `-g20 -w10` (either order), and `-w2501`:
macOS EOVERFLOW is `Value too large to be stored in data type`, candidate is
`Value too large for defined data type`; macOS ERANGE is `Result too large`,
candidate is `Numerical result out of range`. Raw native bytes remain retained;
unit assertions use the separately recorded portable policy. No speculative
formatter change was made to emulate host libc. Initial negative assertions
also exposed five executable-path differences; using explicit argv[0] `fmt`
resolved those QA invocation differences. The four libc byte differences remain
accepted scope limits, not exact stderr parity passes.

C/UTF-8 successful original, mapped-upstream and opaque-byte outputs match each
other. Window/numeric/negative cohorts ran C only: other locale cells remain
unverified. Native long overflow is neither exercised nor emulated; checked
safe-integer arithmetic remains the documented deviation. Actual browser,
workerd and Bun executables were unavailable; Node-hosted conditional realms
passed but do not qualify those engines. Interpreter original/checkpoint/replay
paths were unchanged and not freshly requalified. Broader generated tie/margin
combinations, remaining locale variants and additional independent runtime
engines remain open. Full GNU compatibility is not claimed.

### Maintained gates and installed artifact

- `npm test --workspace=safe-bash-command-fmt`: final 1,023 passed, zero
  failures/cancellations/skips. Includes arguments, budgets, invalid profiles,
  byte ownership, cancellation/cleanup and the new independent controls.
- `npm run lint --workspace=safe-bash-command-fmt`: final ESLint and
  production/test TypeScript checks passed.
- `npm run build:workspaces -- --workspace=@poe-platform/safe-bash`: completed
  successfully through maintained declared dependencies and postbuild stages.
- Node test selection fmt, fmt-adversarial, fmt-boundaries, fmt-registration and
  agent-commands: 768 passed, no failures/skips. Covers pipelines, VFS files,
  SDK parity, redirect partial effects, alias truncation, negative noclobber,
  falsey cancellation and opaque metadata cleanup.
- `npx vitest run scripts/bundle-safe-bash-private.test.ts`: three passed.
  Node-hosted conditional graph/realm checks do not qualify independent browsers.
- Public-only staging with `scripts/package-safe.mjs`, scripts-disabled pack,
  and fresh external offline installation: passed. No private fmt/contracts
  workspace exists in the consumer. Maintained `safe-packages-fmt.mjs` passed
  identity, cross-realm bytes, parser/engine, files, Shell script/pipeline,
  typed/raw SDK, opaque argv and plugin checks. Strict NodeNext declaration
  consumer passed, including exact optional properties and unchecked indexed
  access, both with and without declaration skipping.
- Actual Shell screenshot generated with the maintained generic screenshot route
  and visually inspected: released width8 and quote/sentence width20 output
  readable and correct. The generic route fits this virtual Shell command.
  First harness omitted mandatory VFS and failed; memory VFS correction and fresh
  screenshot completed. No screenshot test or product code change was added.
- `git diff --check`: passed. Full repository test/lint/build routes were not run
  for this isolated test/documentation task; no broad gate is claimed.

Public tarball version `0.0.0-compatibility-fmt`, SHA256:

| Package | SHA256 |
| --- | --- |
| Safe Bash | `63f4d4f0913ca59c962e4b7d04218dc64c48a4c95f64fa486395eaa38956185f` |
| SafeFS | `c5869f867614f14711c08bb00ee0a0a40247b241cb1a59e42fc132ee4abb9be5` |
| SafeJS | `84581d4361d7d31e0227659c89f4ad23029dedf7aa5696bb1f914b1f8b345f20` |

The existing command manifest remains private TypeScript ESM with empty runtime
dependencies. Safe Bash exports its bundled implementation/declarations at
`@poe-platform/safe-bash/commands/fmt`; installed consumers need no unpublished
workspace. This does not claim the entire Safe Bash artifact has zero external
dependencies. Production import inspection found no host executable, ambient
filesystem/network, native/WASM fallback or runtime downloads in fmt; this is
an import/capability assessment, not universal isolation proof for every engine.

Preliminary checks had nine negative diagnostic byte failures before explicit
argv[0]/portable-policy separation; all were investigated as described above.
The initial all-cell unit run passed, but its 24-second large-output work was
moved to manual QA and a separate static transcript. Final small-fixture unit
run passed. No unresolved failure, timeout or incomplete selected run remains.
No benchmark or performance inference is made from test duration.
Task-owned temporary source/build/log/package/screenshot output and isolated
consumer were inspected and purged after durable capture. Automatic review
initially rejected variable-derived recursive cleanup because ownership was
insufficiently established; inspection confirmed both exact task-created paths,
and explicit-path cleanup succeeded. The two gzip files are permanent exact
control fixtures, not temporary logs or shipping runtime assets.

Local commits: none. Verified remote-main delivery: none. Successful releases:
none. No command publication, push or release was requested/performed.
