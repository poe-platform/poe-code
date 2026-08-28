# Separate tightly bounded symlink proof — proposed, NOT EXECUTED

2026-08-28. Root explicitly permits separately sealed preparation. At receipt of
that message exact executable preparation steps were not sealed, so the message's
fallback applied: only regular-file 52+3 ran. No symlink action occurred. This
document proposes the remaining proof; it is NOT an executable preseal or claim
that the existing 52-case observer already implements a six-observation mode.

## Exact proposed namespace and fixture

Owned root, required absent before acquisition:
`/Users/kjopek/Workspace/safe-bash/tests/commands/apply-patch-capture-review-20260828/symlink-v1-01`.

Let `S` be that root plus `/scratch`. The one permitted symlink pathname is:
`S/capture-membership-v3/runs/author-01/work/file-symlink/synthetic-stdout-0.json`.
Its exact link text is `synthetic.json` (14 UTF-8 bytes), resolving to the existing
owned regular file in the SAME `file-symlink` directory. No absolute/external
target, extra target entry, user path, link chain or directory link is proposed.
No chmod of symlinks or permission expansion.

Source is exact 33e2b4c7fb14c2ab5ad23be50ac07bcc4bfed848. Original CONTROLS.json
SHA256 a0978555b6db9e008b64d8f10d86c2c422fe665670c3aa7f4deaf1f186929ea3
contains both `positive` and `file-symlink` rows, including exact regular-file
payload bytes, modes, and the regular restoration bytes for the replaced fragment.
The two original manifest files are EACH 1,137 bytes, mode 0644, SHA256
66bbadd6e0d3753e62323fb1dfab9a67103c3c5b41610f63b8dceb3205ba0509.
Keep original manifest-bindings and admission/parser module bytes unchanged,
relocated together under S exactly as in the completed regular-file proof.
Only these two fixture directories are proposed, no full 66-case replay.

## Proposed actions, in order

1. Authenticate source/tool and the future executable seal. Check the existing
   review directory and parent chain with lstat/realpath: directories, no links,
   expected real paths. Require the new root absent; create it exclusively and
   retain dev/ino identities. All new descendants must be owned regular
   directories. No broad filesystem census or existing user-tree mutation.
2. Materialize the two original finite fixtures, except the designated symlink
   placeholder, with exclusive regular-file creation. Parent checks the target
   is regular, within the new root, and has exact source-bound size/mode/hash.
   Parent alone calls symlinkSync with the exact text/path above ONCE, records
   lstat identity/type/mode and readlink bytes without following it. If denied,
   STOP: no alternate creator, privilege change, target or retry.
3. After preparation is closed, launch one scoped permission-restricted observer:
   same read-only source authority and existing bounded fixture-write policy,
   no full-fs grants, subprocess/worker/native/guest/network authority. Invoke
   the unchanged readCapture and shared admitCapturedTree for a positive fixture
   and the symlink fixture: four observations. Parent preparation reads are
   distinct from observer admission read events.
4. For BOTH negative invocations require CAPTURE_ADMISSION with exact
   `regular file required`; record monotonic per-call read events BEFORE checking
   expectations. No opening/reading/following the link or reading its target
   during those invocations. Do not prehash fixture bodies in the observer and
   then claim zero reads. Source-only authentication may still read manifests.
   Actual readCapture enumerates the namespace before regular-file checks: this
   is refusal of complete admission, NOT refusal before directory enumeration.
   Exact names must match, so an extra-file census rejection cannot substitute
   for the intended symlink/type rejection. The instrumentation and meaningful
   target-read detection countercontrol need a future explicit source seal.
5. After first child exit/close/group absence, parent unlinks ONLY the designated
   link, creates the original regular fragment exclusively with bound bytes and
   mode, then launches the same restricted observer for helper/shared-admission
   restored positives: two more observations. Positive/restored results retain
   the exact 126-byte output, two entries and original tree root. These are new
   symlink-qualification observations, never historical rescores.
6. After both children are observed closed and reaped, check root identities,
   exact source/fixture census and captured integrity. Cleanup only the owned
   new root, unlinking any residual link without following it; retain all raw
   captures, selected primary/later failures and cleanup receipt outside scratch.

Proposed ceilings: one preparation attempt, exactly one link, at most two
harmless children sequentially, peak parent+child two, five minutes including
guards/cleanup, 16 MiB captures and 64 MiB scratch. Keep the existing per-child
45-second/2-second TERM-grace, 128 MiB old-space, 1 MiB stream limits; not RSS or
hard-preemption claims. No new real engine or full-controller run.

Before creation, bind the actual minimal observer adapter, preparation/supervisor
bodies, syscall/read telemetry and countercontrol, exact target/fixture records,
launches and cleanup implementation in a new executable seal. The existing
observer's permission policy and actual readCapture stay unchanged; any required
adapter delta must be explicit, not presented as byte-identical execution of the
old 52-case script. Root may route this proposal or retain the case unqualified.
