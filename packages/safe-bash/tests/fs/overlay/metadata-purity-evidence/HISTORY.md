# Original metadata-read mutation evidence

`history-20260827-v1/` is an immutable, byte-preserving seal made before the
approved metadata-purity implementation or fixture migration. It contains the
complete `/tmp/safe-bash-overlay-readpurity-JuB9ca` investigation, including the
proposal, source hashes, original reviewer result, original strict failures,
and both original-reviewer and reusable-current reproduction scripts.

`canonical-before/` preserves the full original Overlay source and the two
canonical tests that positively asserted readdir-triggered cleanup. Their bodies,
fixtures and expectations are unchanged. Source fixtures and scripts are stored
with an added `.txt` suffix as historical data, outside TypeScript/test discovery;
they are not active current-candidate tests. The original independent subtree is
not edited. Raw failure output retains its original whitespace.

`seal.json` records source/destination paths, SHA-256 values, byte counts, sealing
time, Git HEAD/status, and verification of every copied byte. Original captures
retain their own timestamps, hashes, worktree profiles and limitations. The first
investigation launcher failed to print Node's status because `status` is readonly
in zsh; its raw strict assertion failure is retained alongside the subsequent
replay with an explicit exit-status record. Neither is converted into a pass.

Root authorizes only the subsequent one-argument public readdir repair and
separate strict regressions. The two cleanup-positive canonical controls will be
explicitly migrated to invoke `cleanup()`, retaining their cleanup assertions.
That migration changes the triggering operation, not the recorded old behavior
or the strict requirement of zero backend mutations during metadata reads.

The original strict failures and original positive-effect detector successes
remain historical evidence, not acceptance of the repaired candidate. Later
candidate captures must use fresh directories; never overwrite this seal.
