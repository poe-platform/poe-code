# Shared11 outside-repository setup correction

## Outcome and ownership

Independent delegated leaf verification, performed directly without delegation.
The exact source candidate is `c3e40f8bd721da5e496f3b3abfd51aee45db5a84`.
The full unchanged eleven-file shared command passes **276/276**, exit 0,
with zero failures, cancellations, skips or TODOs. This closes the shared11
temporary-location setup blocker under the qualified setup below, not a product
or assertion correction. No bounded control rerun was needed.

The original review at `beba7b00d5ba277d2ac6770968d8e4b15c846171` remains
**275/276**, exit 1. Its original report, command/result (including complete
failure bytes), candidate binding and source audit are copied byte-for-byte into
`candidate-01/original-*`; its entire live evidence entry set is unchanged.
The old review's independent seal also verifies. The corrected capture is a new,
separately qualified run, not a replacement green result for the original setup.

Only this new evidence directory and one expressly authorized fresh OS-temp
directory were written. No source, canonical test/helper, assertion, fixture,
configuration, dependency or shared `dist` edit; no install, network write,
native-expr recapture, public expr claim or unrelated cohort rerun.

## Frozen correction and exact command

`candidate-01/CORRECTION-MANIFEST.json` was frozen at
`2026-08-27T21:17:00.270Z`, before the isolated build and shared execution.
`FREEZE.json` binds its SHA-256:
`9334d9391b60c4d430885eb2a2d896b3ddafbdd3d980ee1e5f89023917523945`.
It also binds the harness, archived source inventory and original command.

The sole behavioral setup correction is a fresh physical `TMPDIR` outside every
Git ancestor. `TSX_DISABLE_CACHE=1` remains enabled as in the original driver.
The source extraction/build cwd necessarily relocates to the same owned OS-temp
tree; this path relocation is disclosed, not hidden as byte-identical execution
context. The original ineffective `GIT_CEILING_DIRECTORIES` string is preserved
exactly and is not relied upon. Other environment variables use the original
`...process.env` inheritance policy. The old inherited ambient map was not
captured, so historical ambient equality cannot be proven; the corrected map's
relevant values and full-map digest are recorded before execution.

The executable and complete argv equal the original `shared11-process.json`:
Node `--import tsx --test --test-reporter=spec` plus its same eleven test paths.
No extra test filter, preload, wrapper, concurrency flag, timeout increase or
native option is added. The command deadline is 120000 ms, output bound 32 MiB
per stream, and default concurrency is unchanged. Existing native 3000 ms and
public-child 30000 ms deadlines remain untouched. The harness uses asynchronous
pipe collection to permit external read-only fixture/process observation; stdin
is the same empty pipe. This observation is not test/native interception.

Actual shared execution: `2026-08-27T21:17:05.392Z` through
`2026-08-27T21:17:09.845Z`. Its 276 ordered test names match the original run,
including all **86 native rg differential tests**. The originally failing
`rg native differential: gitignore requires git by default` now passes.
Full output/status is in `shared11-process.json`, `shared11.stdout.txt` and
`shared11.stderr.txt` (empty stderr). No assertion or oracle was rebased.

## Native fixture and tool qualification

The owned physical temporary root was:
`/private/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safe-bash-expr-shared-v2-hAyApW`.
Its `temporary` child was supplied as `TMPDIR` when the test runner started.
The same-environment startup probe reports that exact `os.tmpdir()` realpath.
Read-only inspection of the authenticated candidate helper establishes that
native fixtures use `realpath(await mkdtemp(join(tmpdir(), "virtual-rg-native-")))`.
During this actual full run, read-only sampling observed **37 distinct physical
native fixture roots**, each directly under that parent. Sampling is not an
exhaustive native-spawn count. It observed an unchanged `.gitignore: *.txt`
fixture without a `.git` marker; samples are not assigned to a particular test
when timing cannot establish that identity.

Before and after execution, bounded 3000 ms `git -C <path> rev-parse
--show-toplevel` checks return 128 / “not a git repository” for both the owned
root and fixture parent. These discovery processes omit all Git environment
overrides, including the ceiling. Physical ancestor walks through `/` contain
no `.git` marker. The VFS remains the helper's unchanged `MemoryFileSystem`
rooted at `/work`; native fixtures with their own deliberate `.git` marker
remain intact. The location correction removes the unintended host ancestor,
not the existing repository-detection profile or fixture semantics.

Host: Darwin 25.4.0 arm64; Node v22.22.2; TypeScript 5.9.3; tsx 4.23.12.
The native executable is the existing PATH-selected Codex-vendored `rg`, with
the full path/realpath and raw version output/status in `native-before.json`
and `native-after.json`: ripgrep 15.2.0, revision `e89fff89ac`, PCRE2 10.45,
SHA-256 `5d24e1af7efa7811e03df5555eeaa984bc8bd98ab42a5d49ecf30f163273e6c7`.
This matches the original review's post-run binary observation and is now
checked before and after the corrected run. It is a Darwin qualification,
not GNU/Linux evidence. Native helper argv/env/output bounds are recorded in
`qualification.json`; unchanged differential assertions compare exact native
status/stdout/stderr with VFS results. Native per-case stdout is not separately
intercepted or presented as an independent raw capture.

## Candidate, compiler and integrity

The exact original selection is archived from the candidate, never overlaid
with live product files. Archive SHA-256:
`c29675ec05c0697b3d56b13a0fad075bd148df6b0c3a91e597f628a21cee0fa7`.
All **349 source/test/root input files** match their candidate Git objects and
the original extracted inventory, including the admitted `ec59c917` type-only
glob annotation delta. Its precise old/new hashes and diff are retained from
`SOURCE-AUDIT.json` and independently rebound by `audit.mjs`; it is not silently
replaced with the older qualified test.

The existing development-tool directory is symlinked read-only by usage into
the isolated source tree. The same `tsc -p tsconfig.build.json --skipLibCheck
false` build exits 0 with empty stdout/stderr. The entire compiled entry set
and bytes also match the original candidate build: **828 files / 868 entries**.
The complete runtime tree has **1177 files / 1279 entries**, including the
explicitly enrolled build and tooling symlink; source alone has 409 entries.
The main tooling inventory has 314 files / 366 entries and remains unchanged.
Node, compiler, rg, Git and tar paths/hashes/version outputs are captured, with
post-run executable hash checks. This is build/worker-closure qualification,
not a new all-consumer typecheck or service acceptance gate.

Source/test, build, whole isolated runtime, tooling and original-review
inventories compare full entry sets before/after, detecting additions as well
as removals and content changes. The archive and frozen manifest are rehashed.
These are observation-time selected-input checks, not transient-mutation or
global live-checkout guarantees. `SEAL.json` covers this evidence directory
append-aware; captures refuse overwrite and are explicit opt-in `.mjs` drivers,
not canonical `.test.ts` discovery.

## Cleanup and limits

The runner exits normally with no signal. Observed child processes, including
test/native/esbuild children, are absent before deletion and afterward; no
SIGSTOP was used. Worker threads cannot outlive their exited owning process;
no extra per-thread instrumentation was injected into the unchanged command.
Only a Node compile-cache directory remained under the owned fixture parent
after tests; no native fixture directory remained. After children settled,
only the exact mkdtemp-owned root was removed. `CLEANUP.json` records its absence,
zero remaining owned processes and cleanup completion at
`2026-08-27T21:17:10.865Z`; the later audit confirms it is still absent.

No 61/21/moved19 rerun, widened corpus, native-expr recapture, public expr export,
full-project gate, superiority, performance or 72-hour completion claim.

Read-only evidence verification:

```sh
node tests/commands/expr-stress/encounter-shared-outside-review-v2-20260827/seal.mjs --verify
```
