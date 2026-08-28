# Developer observations, not acceptance

Frozen protocol commit: `4e2e582847bc3438f3092f963db05d12fc3bc6c5`,
committed 2026-08-28T02:14:56Z (local Chicago 2026-08-27T21:14:56-05:00).
The assignment label uses August 28; machine timestamps retain their real zones.
Execution followed that commit. Exact first/last timestamps, host kernel, argv,
environment, bytes, effects and process close receipts are in RESULTS.json.

28/28 frozen commands executed exactly once; five are version/help. No additional
native xan command ran. Runtime version stdout is exactly `0.54.0\n`. Every child
closed and every owned process group was absent after close; no timeout, byte cap,
spawn error or signal termination occurred. Five intended discovery/error rows
returned 1; 23 rows returned 0. These are observations, not 23 passing tests.
Original cached source/binary path hashes matched before and after execution;
this check does not detect appended entries. No source build was attempted.

High-risk observations:

- `headers -n` is invalid; default display pads indices to width >=4, replaces
  leading/trailing spaces with middle dots even without ANSI, and sanitizes
  embedded newlines. Multi-file summaries count duplicate names, not sets.
- `headers --csv` transposes names with filenames as headings and empty padding.
- `count -n` includes the first record, contradicting its option help sentence.
  Ragged records count successfully. A lone CR in the middle does not split SIMD
  records: mixed-newline row 10 counts 2, not 3. BOM-only counts 0.
- Headers display rejects invalid UTF-8; select index selection preserves `ff`
  exactly in both headers and values (base64 bytes, not replacement glyphs).
- `select` normalizes header quoting, but comma-input data retains unnecessary
  quotes. Output `.tsv` infers TAB independently of input `-d ';'`.
- Ragged select emits the header before its error. Unterminated quoted input is
  accepted by the zero-copy path, retaining its incomplete quote and adding LF.
- `slice -l 0` emits **all input records**, both with and without headers. This
  is a pinned native defect, not a reason to silently claim a corrected behavior
  is parity. Proposed safe empty-range behavior requires explicit root decision.
- `slice -I 2,0,2` emits rows 0 and 2 once in file order. `slice -L 2` works on
  piped input. Decimal u64 overflow is rejected by argument deserialization.

Scope remaining: zero product implementations, zero independent acceptance rows,
no byte-chunk scheduling oracle, no every-flag/error-format proof, no aliases,
closed-output/cancellation/provider interoperability or performance qualification.
The original limited benchmark `xan-positive` was not rerun or relabeled.
No different reviewer's hidden fixtures were read.

Raw execution directory retained for traceability:
`/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/xan-dev-oracle-20260828-IYxIHW`.
Owned download cache: `/tmp/xan-precode-20260828.X6abEd`; provision includes only
official selected source files, verified crate archives and official release.
Sizes and final cleanup policy appear in the final design receipt.
