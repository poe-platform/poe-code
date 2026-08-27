# Independent trim-fix replay — August 27, 2026

**Scoped acceptance: PASS** for frozen source
`7d7dce7ced596b24e60e1ab3fea5bcd50c070755` against the unchanged independent
30 correctness cases and all 53 pre-frozen allocation/retention/lease cases.
This is not a full-project gate or a broad performance/superiority claim.

## Chronology and immutable evidence

- New holdouts were frozen before any further source edit at
  `b1c823af09c1cc4bf9a13225ef0ae9c170d22d80`; manifest SHA-256
  `cff5906058fc055f44fde01c7e87e6aacb0a2bdc44852a375d5518fdf9a89abd`.
  Root/author notification withheld vectors and released the narrow source work.
- Baseline and first-candidate evidence were committed at `d5d2fcc7`, including
  the original failure counts and the first baseline evidence-transport failure.
  `REPORT.md` is that historical blocked first-candidate checkpoint, not the
  final trim-fix verdict.
- The author-ready marker arrived between drafting that checkpoint report and
  its closure capture. `closure-first.json` truthfully records the newly present
  marker and live streams source change. The earlier first-candidate run itself
  had no live source change. No baseline or candidate evidence was rewritten.
- The ready marker identifies frozen trim source `7d7dce7c` and explicitly
  confirms the author did not inspect independent holdout contents. The verifier
  immediately replayed the same fixtures, not weakened or adapted expectations.

## Keep denominators separate

| Cohort | Prepatch | First candidate 7a517cec | Trim fix 7d7dce7c |
| --- | ---: | ---: | ---: |
| Author original20, author-reported | 17/20 | 20/20 | 20/20 |
| Independent original internal10 | 8/10 | 10/10 | **10/10** |
| Independent original public20 | 14/20 | 20/20 | **20/20** |
| Independent original combined30 | **22/30** | **30/30** | **30/30** |
| New frozen trim policy53 | 21/53 | **23/53; blocked** | **53/53** |

All final test processes exit zero: no skips, TODOs, cancellations or harness
failures. The 53 comprise 30 geometric copy cases, 18 retained-backing cases,
one calibration and four head-exclusion lease/error controls. Original 30-case
fixtures, helper files, expected vectors, loader, runner and freeze manifests
remain byte-identical to their original hashes; the new policy and fixture
hashes remain byte-identical to b1c823af. Copied consumer fixture bytes were
also checked against those original inputs after testing.

Author canonical 39/39 and adjacent 46/46 are separately reported in the ready
marker; this leaf does not re-run or combine them into independent denominators.

## Copy and retention findings

The first-candidate Buffer regression remains a genuine recorded failure. For
the largest frozen geometric workload, byte-correct immutable Buffer went from
zero baseline copy bytes to 2,105,408 first-candidate copy bytes for 16,512 input
bytes. The final trim fix uses **16,512 copied/allocated bytes**, with zero
trim-slice bytes. Every geometric case uses exactly its input byte count in
these instrumented ownership operations. All source kinds and both tail and
head exclusion pass the same frozen bounds.

Oversized-first-chunk cases with retained count 7 observe at most **10 distinct
retained backing bytes** at all tested producer-resume checkpoints, including
the 65,536-byte first chunk case. That case copies 65,563 bytes for 65,552 input
bytes, including compaction. Thus the passing result is not achieved by keeping
a tiny subarray attached indefinitely to a huge owned buffer. Consumed slots
are included in retention observation, not hidden from it.

Source attribution: the only product change from the first candidate is
`src/commands/streams.ts` (six additions, two deletions). It skips empty byte
chunks, deletes fully consumed byte slots, retains owned subviews, and copies
the remainder only when it is at most half the backing length. Internal helpers
and the line queue are unchanged. All new copy operations remain covered by
the frozen constructor/slice/set instrumentation.

The half-backing condition also supplies a narrow source-level explanation:
successive compaction copies for one owned byte chunk form a decreasing
geometric series, rather than repeatedly copying almost the whole remainder.
After trimming, an uncompacted active view retains less than twice its length;
a compacted view owns exactly its length, and consumed byte slots are deleted.
This concerns retained byte-queue state, not transient incoming-chunk storage,
arbitrary host allocations, the line queue, every possible budget or a universal
runtime memory guarantee. These tests use no timing or RSS acceptance threshold.

## Final source and packed-package authentication

Final source SHA-256 values:

- internal.ts: `ade20c95a7d3dac5250a214d112ab25d710ce7909a4c6605f18ee21781949654`
- streams.ts: `be601a62f51a95c62778987118e292aea6637ca4e7271486239af2f8d65e7d1c`

The complete 217-entry source/config/contract/AGENTS map matches before/after
the isolated committed-source build and test run. Its product source inventory
also matches the archived src tree exactly, with no omitted new product files.
The live source map is unchanged during this final run. Original manifest,
build configs and root dist are not edited by the verifier.

The final run again uses genuine offline `npm pack --ignore-scripts`, the
unaltered original manifest/files list and original README, physically moves
the archive, and extracts it into a separately named consumer's node_modules.
No dependency downloads, network requests, synthetic export map or repository
self-reference are involved. Both the runner and unchanged public fixture
assert bare-package import.meta.resolve points at the extracted package.

- Final archive SHA-256:
  `4ef37387fec7b4ce86ed11685d83f9886a1532898059c14f91ea60eafa5a0e73`.
- **706 package files** match archive inventory and actual staging bytes and
  remain unchanged after testing.
- The unchanged independent loader authenticates **164 unique loaded package
  modules**, including index, internal helpers and streams.
- Exact commands, npm pack metadata, source/fixture maps, loaded asset hashes
  and raw TAP are in `evidence/final-trim-*`.

## Boundaries and closure

Borrowing follows the user's legal next-read/finalizer/awaited-write schedule,
executable `tests/contracts/io.test.ts:41` and `:144`, helper copy/await behavior
and AGENTS. Bare ByteSource alone has no explicit lease duration. No malicious
host-JavaScript isolation, concurrent mutation guarantee or cancellation rollback
is claimed. Positive-count modest holdouts do not certify every count, buffer
limit, backend or unrelated command.

No production, FS/runtime, root/config/dependency or other owner's files were
changed by this verifier. No broad all-tests run or regex probes were performed.
All test/build/package children returned, no server or detached process was
launched, Shell cleanup completed, and test instrumentation is restored in
finally. Final closure records zero remaining owned runner processes. Historical
first-candidate failure, prepatch failures and harness corrections stay preserved.
