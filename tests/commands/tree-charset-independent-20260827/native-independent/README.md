# Independent native tree charset freeze

This is an additional independent **post-source-commit** native holdout freeze.
No independent pre-source-commit claim is made. At capture time the candidate
commit already existed, and only its Git commit metadata was read. Candidate
source, candidate tests, author handoff material, sibling review output, and the
candidate executable were not inspected or executed. The freeze was made during
a concurrent review and does not adopt another verifier's source exposure.

## Identity and capture boundary

- Candidate identity: `f1a90436c45208ca248e058a039893233c608daa`.
- Oracle: native tree 2.2.1, Darwin arm64, authenticated realpath and SHA-256 in
  `native-capture.json`.
- Capture instant: `2026-08-27T17:32:48.856Z`.
- Every child received an explicitly constructed environment with only
  `PATH=/usr/bin:/bin` plus the variables listed for that case. Standard input
  was ignored. The fixture was the child's current directory and the sole path
  argument was literal `.`; this is the only absolute-path normalization.
- Every child emitted at most 64 KiB per output stream, had a 3-second deadline,
  and was awaited through its actual `close` event. All 20 children closed with
  code 0, no signal, no timeout, no cap event, no spawn error, and empty stderr.
- The fixture uses only simple ASCII names. It has an empty directory, nested
  directories, and three simple files. `capture-native.mjs` creates the otherwise
  untrackable empty directory, authenticates the oracle before spawning it, and
  rejects extra fixture entries.

The first capture-driver preflight is retained in `preflight-failure-v1.txt`.
It stopped before native cases because `/tmp` resolves to `/private/tmp` on this
host. The corrected driver authenticates the exact observed realpath and the
pinned binary hash.

## Frozen interpretation

The literal parity holdouts are connector/output byte shapes and precedence for
the cases marked `native-parity-literal` in `native-capture.json`. ASCII output is
111 bytes; UTF-8 output is 147 bytes. Both raw files retain the native summary
line `4 directories, 3 files` only for whole-output equivalence on this fixture.
This freeze creates no new count, traversal, sorting, escaping, or annotation
semantics and does not alter the older strict excluded-root count recipe.

Empty and unknown charset/locale results are deliberately marked
`native-only-observation`; they do not infer virtual error or fallback behavior.
In particular, Darwin native tree rendered ASCII for `LANG=en_US.utf8`, but the
user-supplied virtual contract classifies lowercase `.utf8` locale aliases as a
virtual extension, not native parity. No arbitrary locale suffix is treated as a
known virtual alias. The later virtual executor must independently apply the
bounded own-key selection order `--charset` > `TREE_CHARSET` > `LC_ALL` /
`LC_CTYPE` / `LANG` > ASCII fallback, explicit virtual aliases, no ambient env,
terminal byte/UTF-8/escaping behavior, work caps, abort and backpressure rules,
and the no-traversal/count-change constraint. Those contract-only requirements
are not claimed as observations of this native binary.

This supplementary cohort is not full native parity, a whole-gate rescore, or a
replacement/rewrite of any earlier fixture.
