# Retained attempts

Attempt 1 (`/tmp/shared-stdin-independent-baseline-attempt-1`) archives, builds,
packs and moves successfully, but its first child fails before any behavior
executes. On Darwin, `/tmp` resolves to `/private/tmp`: the strict loader used a
realpath while the runner allowed a lexical `/tmp` root. No product result is
claimed. Fix: canonicalize the newly created scratch root before deriving the
allowed roots. Frozen probes and expectations remain byte-for-byte unchanged.
The original command stderr, authentication and failure receipt are retained.
