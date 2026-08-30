# Helper attempt history

Snapshot attempt 1 at 2026-08-27T04:54:37.271Z stopped before copying or
executing product. New reviewer manifest guard incorrectly used localeCompare
instead of byte lexical sorting; README ordering caused hash927e58a5 rather
than the recorded57c6e29c. All seven current source bytes independently match
commit4af1b107d4b9449a2c4e7fed467d187448392fd5 via git show; byte-sorted
path-NUL-digest-newline manifest matches57c6e29cc6fae6dce5946dddb211b0cc1bf94ef20badb4286546aeafe1e1d553.
This is a helper fault, not a product failure. Empty initial snapshot directory
retained. Correct only the manifest ordering before a new snapshot attempt.

Initial contract-run filter at04:55:14Z used a negative lookahead that matched
the node:test file ancestor and ran124 tests rather than39. Original85 were
re-executed (80pass5fail), not new fixtures; contract subset35pass4fail.
Switch to explicit positive contract name prefixes on next run. Preserve TAP.

Four directory-diagnostic assertions required the uncontracted phrase 'is a
directory'. Actual existing FsError EISDIR describes 'illegal operation on a
directory', with correct path and command prefix. This is distinct from GNU
stderr-parity and unrelated historical diagnostic work. Replace only this
prepared-harness assumption with exact full existing ENOENT/EISDIR text,
and assert unchanged namespace, directory contents and surviving file bytes.
No source changes and no blanket diagnostic weakening. Initial TAP preserved
before helper correction; previously failing assertions blocked stdout/effect
checks, so those effects are not claimed verified until corrected run.

Contract-only attempt2 at04:56:44Z correctly selected39 tests but repeated35/39:
the newly added namespace assertion incorrectly expected string[] rather than
the actual public FileSystem DirEntry[] shape. Exact stdout/status/stderr and
raw namespace/file bytes were captured before failure. This reviewer-introduced
helper type-shape mistake is not a product failure. Correct only the expected
entry objects and retain both prior raw attempt artifacts; no corpus changes.

Publisher attempt1 at approximately05:00Z stopped on byte validation: adding
empty stderr.txt through apply_patch produced one LF rather than zero bytes.
Private original empty stderr and its e3b0c442 hash remain unchanged. Remove
only that just-created incorrect public empty artifact with apply_patch and
publish stderr as JSON string (""), preserving exact decoded raw bytes.
No native/product execution was retried by this publisher fault. Previously
published matching files remain byte-checked; complete publisher on retry.
