# PRE-EXECUTION additional-v2 discovery protocol

Exactly 16 once-only native calls in ROWS.json, all UNKNOWN-DISCOVERY. No original
row rerun, help, version, benchmark, shell, network or installation. This scope
is native reference data, not canonical tests or product implementation.

Prior qualification: protocol 4e2e582847bc3438f3092f963db05d12fc3bc6c5;
observations 4628da200ba3f79f13a07ea8f5881206f70e6819: 28 calls, 23 status 0,
5 status 1, immutable observations, never passes. Pinned source 0.54.0 commit
2f9156c8ec79a3ecc09e0879735ac68ec8997b7a. Existing verified binary and primary
cache are reauthenticated, never replaced. BINDING.json hashes original evidence,
local read-only contracts and primary source; records runner SHA256 before commit.

Purpose/source proof: slice.rs run_default 287-329 and util.rs range 168-195
require start/equal/end-zero probes; slice.rs run_last 330-380 has distinct
reverse-file and forward-pipe zero-tail paths. SIMD core.rs split_record/read_record,
records.rs and utils.rs qualify CR/quote/BOM processing; headers uses csv-core
reader.rs NFA. Rows 06-16 fill command-specific CR, malformed, BOM/reordering and
cross-delimiter gaps, not a Cartesian qualification. Exact stdin is hex; fixture
file strings encode UTF-8 without transformation. Outputs=[] means no file writes.

Run only after committing PROTOCOL.md, ROWS.json, BINDING.json, run.mjs together.
Runner requires clean owned scope; records its latest scoped commit. Persistent
exclusive /tmp/xan-final-profile-v2-20260828.once prevents a second run. Each cwd
is a unique row child of a newly allocated OS-temp directory. Non-TTY pipe stdio;
absolute pinned executable, literal argv; no shell. Environment replaces inheritance:
LC_ALL=C LANG=C TZ=UTC NO_COLOR=1 TERM=dumb PATH=/usr/bin:/bin, HOME=TMPDIR=row cwd.
Retain actual Darwin/Node host and timestamps; UTC child TZ does not rename host zone.

Limits: <=64 KiB aggregate stdin+fixtures per call, <=5 seconds per child,
<=1 MiB combined stdout/stderr and <=1 MiB file effects. Only the one declared
input file is staged; no output operands/child filesystem writes. Tiny finite
non-expanding vectors bound effects, not a fictitious OS quota. Aggregate <=80s.
Each child owns a detached group. Parent signal/cap kills that exact group; await
close to reap, check ESRCH, stop if residual group or preparation/cap failure.
Record failure without retry. Native executable is not permitted to spawn workers
by these options. No universal escaped-process/uninterruptible-kernel guarantee.

Capture raw JSON only in fresh scratch; separate evidence commit with apply_patch.
Original files and all listed source paths hash-checked before/after; this checks
original paths, NOT new-entry/append-proof tree integrity. Foreign changes do not
enter this protocol. Additional observations are not independent acceptance.
