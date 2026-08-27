# Independent DU/Overlay holdout refinement v2

## Chronology and authority

- Frozen at `2026-08-27T18:17:26Z`, after the initial contract and after the
  limited baseline API inspection recorded below, but before any candidate was
  supplied, inspected, or executed. This is not a claim that the freeze predates
  an author's work or commit.
- This document only adds detail to
  `HOLDOUT_CONTRACT.md`; v1 remains unchanged. Its embedded freeze time is
  `2026-08-27T18:11:22Z`, and its atomic one-file commit is
  `510c621e1dfa8f7ffba1d796f5f7e55d967368e2` at
  `2026-08-27T18:12:07Z`. The v1 blob is
  `51406b62895f1163a863ffe61d072bb14af8292b`.
- No candidate exists for this verifier. Mutable `HEAD` product files are not
  candidate inputs. Runnable baseline/candidate work belongs to the other
  verifier, not this freeze refinement.
- The words `freeze`, `baseline`, and `historical` in the assignment were labels;
  the immutable revisions used here are respectively `510c621e...`,
  `877144ea3a5223bbdf3e7ebfd50a8f8caaa474f3`, and
  `19cc7e8c3567b521e04159010efe32da5673b5b4`.

The only baseline APIs inspected were these exact blobs: Overlay
`f75793a6230fbc3ed1823d313407cd6e062c2746`, ReadOnly
`c3f291f04374001d2070235de9bc07d99ef8c2a2`, Mount
`27c88f249f157b1073ba3cdd9252a088ac48a7a0`, DU index
`f017341290ee1b17eeb44c7a5c3b162fd82e1688`, arguments
`39a4c00b5cb4cc616c720ddab633332f1429beaa`, implementation
`ff5619f2f5d33a37747c8aeb13c30b2142926d64`, and README
`00e40726b99a93e578f38f32ba5d90a45eb9deec`. API-dependent details below are v2
assumptions, not claims about what was knowable at the earlier v1 timestamp.

## Exact backing fixtures and observations

Use distinct instrumented Memory upper/lower backends. Seed before counters and
the action-window snapshot are taken:

```text
lower /holdout/lower-only.txt  = UTF-8 "lower-only\n" (11 bytes)
lower /holdout/shared.txt      = UTF-8 "lower-shared\n" (13 bytes)
lower /holdout/sub/child.bin   = bytes 00 01 02 03
lower /holdout/whiteout.txt    = UTF-8 "whiteout-lower\n" (15 bytes)
upper /holdout/shared.txt      = UTF-8 "upper-shared\n" (13 bytes)
upper /holdout/upper-only.txt  = UTF-8 "upper-only\n" (11 bytes)
upper /pending-source.bin      = UTF-8 "pending-garbage\n" (16 bytes)
```

Create the whiteout only through public
`overlay.rm("/holdout/whiteout.txt")`; it must hide the lower entry without
deleting it. Create pending garbage only through public
`overlay.rm("/pending-source.bin")` while the upper wrapper delegates the stage
rename but refuses the first recursive forced `rm` of the observed root matching
`/.virtual-bash-overlay-<UUID>`. Record that exact root. The removal call must
succeed, the root and its `entry` must remain in upper, and both the stage root
and `/pending-source.bin` must be absent from Overlay `readdir("/")` and from
standalone `du -ba /` output. Do not reach into private fields to manufacture
either state.

Snapshots enumerate every backing path, entry type, complete stat value, and file
bytes in deterministic path order. Snapshot reads occur outside the measured
action window and counters are reset afterward. For each action below, compare
pre/post snapshots byte-for-byte and separately record upper/lower calls. The
forbidden action-window calls are `readFile`, `readStream`, `writeFile`,
`writeStream`, `appendFile`, `mkdir`, `rm`, `rmdir`, `unlink`, `rename`,
`copyFile`, `link`, `symlink`, `chmod`, `utimes`, and `truncate`; any staged
copy-up also fails the case. Awaited `lstat`, `stat`, `readdir`, `realpath`,
`access`, and comparison calls may increase only where the selected operation
requires them.

Run `stat`, `lstat`, and `readdir` cases independently on fresh fixtures, plus
standalone DU through built `dist/commands/du/index.js` created from the
authenticated standalone source module. Use `-ba /` for the pending-name check
and `-b /holdout` for the metadata traversal. No root export, package subpath,
aggregate registration, or repository fallback is permitted: public DU is
intentionally absent from this freeze.

Before and after every metadata/DU action, require the same merged names and
visibility; the same `identityScope` reference and `dev`/`ino` presence and
values for `/holdout/shared.txt`, `/holdout/lower-only.txt`, and
`/holdout/sub/child.bin`; and the same `compareEntry` results against their
actual upper/lower entries. The whiteout remains effective, the pending root and
source remain hidden, and the pending upper bytes remain present. Missing
identity stays missing. There are zero backing writes/deletes, cleanup attempts,
copy-ups, and content reads in the action window.

## Exact compositions, stage barrier, failures, and controls

Repeat the metadata/DU invariants for these separately constructed compositions:

1. `OverlayFileSystem({ upper, lower })` directly.
2. `ReadOnlyFileSystem(directOverlay)`.
3. `MountFileSystem({ root: separateRoot, mounts: { "/mnt": directOverlay } })`,
   traversing `/mnt/holdout` and `/mnt` (Mount above Overlay).
4. An Overlay whose upper and lower are each a
   `MountFileSystem({ root: separateRoot, mounts: { "/mnt": layerAtMnt } })`,
   with the literal tree in each `layerAtMnt` under `/holdout` and traversal at
   `/mnt/holdout` (Overlay above a real `/mnt` boundary). Baseline reports this
   multi-mount upper as non-atomic/read-only; that limits mutation controls but
   does not waive metadata purity.

Pending cleanup cases apply where the direct Overlay instance is reachable,
including compositions 1-3. Composition 4 is not credited for unsupported
staging. Unsupported behavior is a reported gap, never a pass.

Freeze active-stage behavior separately on a fresh direct Overlay. Start public
`writeFile("/active-publish.bin", Uint8Array.of(0x41), { flag: "wx" })`. The
upper wrapper delegates creation of the observed stage root, then pauses before
returning from that stage `mkdir`. While paused, enqueue exactly one Overlay
metadata operation (one fresh run each for `readdir("/")` and standalone
`du -ba /`). Baseline's public Overlay serializes operations: assert that the
queued read admits no backing call and causes no additional effect before release.
After release, await the mutation and then the read. The read must match a control
where the same mutation fully completed first, expose no stage name, and add no
mutation/content call. Attribute the authorized stage mutation separately; do not
mislabel it as a metadata effect.

Inject a single `FsError("EIO", { syscall: "lstat", path:
"/holdout/sub/child.bin" })` from the lower wrapper at that exact path. Standalone
DU must return status 1 with no total for the incomplete operand and no backing
change. Disable injection and retry on the same fixture; it must succeed without
an intervening cleanup/mutation. Also test a pre-aborted signal with exact reason
`Error("v2-pre-abort")`, and a mid-traversal barrier on lower
`lstat("/holdout/sub/child.bin")` aborted with exact reason
`Error("v2-mid-abort")`. Each rejects with the identical reason object and leaves
snapshots/counters pure.

Positive controls use fresh pending fixtures. `overlay.cleanup()` must remove the
recorded pending stage and increment upper `rm`. Separately, a normal public
`writeFile("/holdout/control.bin", Uint8Array.of(0x43), { flag: "wx" })` must
first remove pending garbage and then publish the byte, with both effects visible
to counters/snapshots. Retain the v1 read/content/copy-up mutants. These controls
must prove that the oracle detects cleanup and mutation; they are not purity
passes.

## Exact `DU_BLOCK_SIZE` matrix

Use literal `/env-size-1500.bin` containing 1,500 bytes of `0x61`. Its instrumented
`lstat` reports `size: 1500` and `allocatedBytes: 4096`; no content read is allowed.
Use only own properties of the supplied environment map and keep
`POSIXLY_CORRECT` and `BLOCKSIZE` absent.

| argv / environment | required status and stdout |
| --- | --- |
| `du /env-size-1500.bin`, `{}` | `0`, `4\t/env-size-1500.bin\n` (`defaultOut`) |
| same, `{ BLOCK_SIZE: "3072" }` | `0`, `2\t/env-size-1500.bin\n` (`lowerOut`) |
| same, `{ DU_BLOCK_SIZE: "invalid-value", BLOCK_SIZE: "3072" }` | `0`, exactly `defaultOut`, not `lowerOut` |
| same, `{ DU_BLOCK_SIZE: "", BLOCK_SIZE: "3072" }` | `0`, exactly `defaultOut`, not `lowerOut` |
| `du -B invalid-value /env-size-1500.bin`, `{}` | nonzero, empty stdout, zero filesystem calls |
| `du -B3072 /env-size-1500.bin`, `{ DU_BLOCK_SIZE: "invalid-value", BLOCK_SIZE: "1024" }` | `0`, exactly `lowerOut` |

Thus the selected variable is specifically `DU_BLOCK_SIZE`: its invalid or empty
value chooses the no-environment default and must not fall through to lower
`BLOCK_SIZE`. Explicit invalid `-B` remains strict. These numeric expectations are
the versioned v2 refinement made possible by baseline API inspection.

## Retained evidence and exclusions

The historical report is revision `19cc7e8c...`, README blob
`7ab95202e7acb054f807420feb9956372c0872d6`. It identifies the preserved strict
actual-backend red result: DU metadata traversal caused exactly one upper cleanup
`rm`. Its immutable raw evidence path is
`tests/commands/du/independent/evidence/review-MduamP/independent.json`, blob
`e92154860ecd35c470a64bd092c093a7c2b87385`. This v2 neither reruns nor overwrites
that artifact.

Native record ordering is explicitly out of scope rather than silently counted:
the same historical README records the three retained ordering IDs `-a tree`,
`-ac0B512 tree`, and `--all --total --null --block-size=1 tree`. Repeated operands
policy is **UNAPPROVED** and excluded. No native audit, broad DU audit, public
integration acceptance, candidate acceptance, superiority, or project completion
is implied by this bounded additive freeze.
