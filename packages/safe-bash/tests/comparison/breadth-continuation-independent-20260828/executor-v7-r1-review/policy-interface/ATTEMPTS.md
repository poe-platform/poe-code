# DATA attempt ledger

1. Preseal `3f3d2f7a`; first `before` invocation exited 1 before producing
   BEFORE.json: checker incorrectly required every sealed historical materialized
   input to be a Git blob. First missing path was executor-v6 admission-v6-01
   child-003.json. No engine or executor child launched; no product conclusion.
   The initial whole-tree metadata scratch was 7,440,833 bytes, not a compliant
   evidence record. It is removed, not offered as bounded evidence. Its content
   is reproducible Git metadata; no runtime evidence is lost.
2. Correction presealed before retry: distinguish exact committed blobs from
   historical materialized bytes authenticated by the exact committed seal.
   Missing Git bodies remain explicitly counted, never claimed committed blobs.
   Filter tree metadata in memory before writing a bounded tree record. Run
   `git ls-tree -r 230ed3c6e15617b312760367adf9ede4e5c7ff6a | node "$P/check.mjs" tree`
   and then the existing before/after commands. The initial REQUESTS.txt stays
   unchanged; missing responses are retained as classifications, not suppressed.
3. Corrected preseal `67233342`; completed BEFORE.json is not all-pass:
   322/322 bound input bodies/modes match, 480/481 data checks pass, and both
   namespace censuses match. The failing whole-seal import check identifies
   coordinator-report-v1/publisher.mjs importing unbound ./records.mjs.
   This is not automatically an active admission-path defect. Before the final
   capture, the checker is extended to report the already-computed 48-file
   admission-seeded closure and whether that particular missing edge is active.
   The original failing assertion and BEFORE.json remain untouched. No additional
   runtime or original comparator-source checks are introduced.
4. Final preseal `ca45652c`; AFTER.json completed with 483/484 assertions, retaining
   the same historical helper failure. Active 48-file closure has no missing
   static relative edge. All 322 before/after source hashes/modes and both namespace
   censuses match. Captures are 172786 and 177118 bytes; filtered tree metadata
   42843 bytes; requests metadata 41095 bytes. No runtime qualification follows.
