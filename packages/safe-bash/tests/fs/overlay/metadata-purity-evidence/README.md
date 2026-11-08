# Overlay readdir purity — bounded author result

## Commits and ownership

- Historical seal: `cbe60769058bbe53a8c0121c8bb18a0fd8f27ff1`.
- Minimal backend repair and new strict tests:
  `1c793b934dcd06aa42e0df24a7228b395178cf3d`.
- This subsequent migration/evidence checkpoint changes only the two authorized
  cleanup-positive tests and this owned evidence subtree. Public/root exports,
  DU implementation, contracts, other providers, and `independent/**` are not
  edited. Root assigns independent review separately; this is not self-approval.

The complete original investigation, original strict-red artifacts, original
reviewer fixture, source hashes, and original canonical cleanup-positive test
bodies/expectations were sealed **before** implementation. See `HISTORY.md` and
`history-20260827-v1/seal.json`. Every copied byte was verified; historical
scripts and TypeScript are `.txt` data, outside canonical discovery. Raw TAP
diagnostic whitespace is deliberately preserved, not reformatted.

## Product delta

`src/fs/overlay/index.ts:536` passes `false` as the existing third argument to
`run` for public `readdir`, matching `stat`/`lstat`. `source-change.patch` contains
the entire one-line product delta. The run default and internal listing callers
are unchanged. No new capability, garbage cap, disposal API, or command fallback
is introduced.

Resolution has no create mode on this path. Listing still checks permissions,
follows the existing symlink-verification path, enumerates upper/visible lower,
and filters children through lookup. Hidden active/pending roots and descendants
stay hidden without being removed. Nested Overlay instances use the same repaired
method; ReadOnly and Mount delegation remain unchanged. There is no new copy-up,
whiteout, opacity, identity-scope, comparison-authority, snapshot-rmdir, atomicity,
or metadata-error rule. Arbitrary custom host providers are not sandboxed.

## Exact fixture migration

`migration.patch` records the full authorized delta:

- `tests/fs/overlay/allocation.test.ts:139`: the content-read cleanup control is
  retained. The second trigger is explicitly named `cleanup`. It still asserts
  the same visible readdir result, now additionally asserts no removals/mutations
  from that metadata read, calls `overlay.cleanup()`, and retains positive
  removal, final upper namespace, lower-byte/metadata, and no-lower-mutation
  assertions.
- `tests/commands/du/backends.test.ts:78`: original pending-garbage setup, DU
  invocation, command trace, positive removal assertion, and final absence
  assertion remain. Before explicit `cleanup()`, the test now asserts zero
  removals and an unchanged backing listing. Its name and positive assertion
  explanation identify explicit cleanup, not a preserved bug detector.

This intentionally changes the cleanup trigger; it is **not unchanged-fixture
acceptance** of the old readdir mutation. Original bodies and expectations remain
byte-for-byte in the first historical commit. The frozen independent reviewer and
its original strict FAIL remain untouched. The new strict DU test does not invert
the old detector: it independently requires zero mutations while retaining the
original setup and successful `0\ttree\n` result.

## Captures and counts

| Capture directory | Strict tests | Focused regressions | Scoped strict types |
| --- | --- | --- | --- |
| `original-source-SkBq8M` | 10 pass, 20 fail / 30 | Not run | Exit 2 |
| `qualified-original-xsv45f` | 11 pass, 19 fail / 30 | Not run | Exit 0 |
| `repaired-BscHHg` | 30 pass / 30 | Not run | Exit 0 |
| `exact-tests-old-overlay-ZW4MmR` | 11 pass, 19 fail / 30 | Not run | Exit 0 |
| `migrated-ss88qj` | 30 pass / 30 | 416 pass / 416 | Exit 0 |

All directories are beneath `captures/`. The final 446 passing tests have no
skips, TODOs, or cancellations. The strict cohort has 26 Overlay tests and four
actual-Shell DU views: direct, ReadOnly, Mount, nested Overlay. The focused cohort
is exactly the 17 files listed in `capture.mjs` and the capture's command record;
this is not a repository-wide gate, whole-build, or public-package acceptance.

The first attempt is preserved rather than relabeled: the test's stream collector
omitted its required options argument, and a byte-snapshot helper changed atime
before an exact stat comparison. The collector now supplies a 16-byte limit;
stat control reads are ordered after those intentional snapshot reads. Assertions
were not weakened. Node also created a compile-cache file in the isolated runtime,
which the added-file postcheck detected. Subsequent child runs explicitly disable
that cache as well as tsx's cache. Original test/driver bytes, raw failures, type
error, and added-file observation remain in the first capture.

The qualified-original capture precedes strengthening DU instrumentation to track
all upper/lower mutator methods in addition to the original rm trace. Therefore
it is not presented as identical-input proof. The later exact-tests old-Overlay
control uses the final new test bytes and all the same copied product/configuration
inputs as `repaired-BscHHg`, changing **only** `src/fs/overlay/index.ts` to the
authenticated sealed original. It fails 19 cases, including all four strict DU
cases. `comparison.json` records that exact input comparison. The live source was
never reverted or patched to run this control.

## Covered behavior

- Pending roots/descendants remain inaccessible while root, directory, symlink,
  repeated, ReadOnly/Mount/nested/composed metadata reads preserve storage and
  selected stat/identity. All enumerated upper/lower mutators are observed;
  metadata paths must not dispatch `compareEntry`.
- Missing/non-directory/permission/backend errors, retry after backend error,
  pre-aborted errno-shaped reasons, in-flight listing cancellation, and queued
  cancellation preserve their existing results without cleanup. A canceled
  queued reader cannot release an active writer's turn.
- Active stream stages remain hidden. Metadata preserves both pending and active
  stages; explicit cleanup removes pending garbage but not active input. The
  writer can subsequently publish and clean its own stage.
- Retained removed content, committed whiteouts, rename opacity, and selected
  upper identity survive metadata reads and later explicit cleanup.
- Cleanup failure retains its entry and reports AggregateError after the existing
  two passes; successful retry drains it. The existing admitted-cleanup behavior
  may complete after caller cancellation without undoing a committed directory.
- ReadFile/readStream, mkdir/writeFile/copyFile cleanup triggers and ordering stay
  intact. Same-entry copy rejection occurs before cleanup; rmdir still performs
  only its existing safe removal, never recursive garbage housekeeping. Existing
  focused identity/authority/snapshot-rmdir/scoped-link/stream regressions also pass.

## Retention and cancellation limits

This removes a metadata-read cleanup trigger; it does not solve garbage storage
management. Failed stage cleanup keeps path names in a Set and may retain empty
stage roots, partial/full content, or an entire removed tree in upper storage.
There is no aggregate byte/count/age/retry/time cap or background timer.
`maxBufferBytes` is not a garbage budget. Metadata-only workloads can retain that
storage indefinitely until an existing mutation/content-read/explicit-cleanup
trigger succeeds. The Set stores names, not native file handles; active stream
resources have their separate invocation/iterator lifetimes.

Staging finally cleanup, default-run mutation housekeeping, copyFile's cleanup
after identity checks, readFile/readStream housekeeping, and explicit `cleanup()`
remain unchanged. Rmdir remains opted out. Explicit cleanup first runs a
non-strict pass, then a strict pass, so one entry may be attempted twice.
Cleanup deliberately omits the caller signal from upper recursive rm; admitted
cleanup may continue after abort, wait for uncooperative work, and delay
settlement. Failed cleanup does not roll back publication or replace the original
staging outcome. There is no Overlay dispose API, no automatic filesystem cleanup
from Shell disposal, and no crash-recovery promise.

## Isolation, integrity and reproduction

Each opt-in capture creates a fresh evidence directory using exclusive file
creation. It copies the selected TypeScript-resolved local import closure plus
configuration/contract inputs into a unique temporary runtime, links existing
installed tooling, runs exact source-import test paths and strict `--noEmit`,
then removes that owned runtime. Native fixtures from existing focused Real tests
therefore live only inside the owned runtime, not shared fixture/evidence paths.
No shared `dist`, dependency install, original artifact overwrite, or native
external oracle is used.

Before/after hashes cover every copied input. Postchecks also enumerate new
non-node_modules runtime files; they do not inventory empty directories or the
installed tooling tree. The final capture reports no changed inputs, new files,
or live input changes during execution. This is an isolated worktree snapshot,
not a Git archive/full-repository append-proof gate. Node/platform/libuv/compiler,
Git state, exact commands, source/test hashes, driver/input bytes, raw logs and
cleanup paths are recorded per capture. Typechecking is not service acceptance.

```sh
node tests/fs/overlay/metadata-purity-evidence/capture.mjs reviewer-current all
node tests/fs/overlay/metadata-purity-evidence/capture.mjs reviewer-original strict original-overlay
```

The second command is an explicit historical-source sensitivity control, expected
to fail strict tests; it is not a current canonical test or acceptance result.
Canonical tests never run this driver or write captures.

## Final owned source/test SHA-256

```text
829352e34a662868ddac3385317bf2f7eea8f605ea55e995865a6dd95ddc0d17  src/fs/overlay/index.ts
3ebc474c72b48c5b6e7bfa775ebce9ad76d46a0f8ad29653e9470eb873188685  tests/fs/overlay/metadata-purity.test.ts
d6f29b5611e515b5813517325f9e3edf616b552d869736dadb4e74086abd1309  tests/commands/du/overlay-purity.test.ts
d89724cf8a8693a941128dc82d92278993116d5cb91a34de2c0cf71daa80ab98  tests/fs/overlay/allocation.test.ts
d6af2c78aa038fbef9275db4e0e0405e46b441d93f939be0b6ea8f9f9f89a6a1  tests/commands/du/backends.test.ts
```

Author green is not independent approval, universal backend purity, public DU
wiring, a whole-gate pass, superiority, or completion of the broader project.
