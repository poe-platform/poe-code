# #640: bounded human numeric sort

## Authorized scope

September 5, 2026. Implement only `sort -h` / `--human-numeric-sort` in
`packages/safe-bash/src/commands/text.ts`, with the new focused
`packages/safe-bash/tests/commands/sort-human-numeric.test.ts`.
Root owns integration-input registration and final maintained gates. No README,
other command, shared build output, Git or GitHub mutations.

## Behavior and implementation boundary

- Reuse exact decimal descriptors/comparison, charged parsing, bounded descriptor
  caches and existing sort record admission. Do not convert decimal keys to Number.
- Order by sign, suffix rank, then exact decimal value; reverse magnitude/rank for
  negatives. All numerical zero forms ignore suffix rank. Recognize `k`/`K` and
  uppercase `MGTPEZYRQ`; lowercase units other than k remain unrecognized unless
  the already-supported ASCII folding option is used.
- Preserve numeric-prefix parsing (including unsupported leading plus/exponent
  syntax), raw bytes, LF/NUL records, tie breaking, stable/unique/check/reverse,
  local key flag precedence, input/output capability checks and cancellation.
- Add h to key modifiers. Reject h+n only on effective comparison flag sets;
  explicit key-local flags replace global flags as they already do. Keep `-g`,
  `--general-numeric-sort`, version sort and locale-aware numeric parsing unsupported.
- Modern R/Q suffix ranks follow the GNU manual, but local GNU 8.30 does not
  recognize them; do not claim native-oracle coverage for that extension.

## TDD and focused verification

1. Add failing tests for mixed units, sign/rank/value ordering, case, zeros,
   negative/large/fractional precision, reverse/stable/unique, key inheritance and
   local overrides, and effective h/n conflicts. Pin unsupported g behavior.
2. Add NUL/invalid-byte/reused-buffer, check/output, admission and cancellation
   controls for the new comparison paths.
3. Capture RED before editing product source; implement narrowly; run new tests
   and adjacent maintained text/sort tests. Record GREEN separately.
4. No full build/typecheck/shared-dist mutation or guarded whole-tree lint during
   concurrent work. No maintained owned-path lint route has been identified;
   lint remains pending root's frozen maintained gate, without a bypass.

## Tiny native oracle qualification

Local executable `/usr/bin/sort` identifies as GNU coreutils 8.30. Native probes
use `--parallel=1 -S 64K`, LC_ALL=C, stdin-only inputs, 1-second timeout and
8-KiB output cap. Normal sort probes timed out inside the sandbox; the explicitly
approved outside-sandbox retry succeeded. Timeout observations are not product
failures or oracle passes. No native utility is used by product code or tests.

Verified captures (each successful case has empty stderr):

- `-hs`, input `1G\n2000M\n-1G\n-2000M\n0G\n-0M\n0\n1K\n10000\n`:
  status 0, stdout `-1G\n-2000M\n0G\n-0M\n0\n10000\n1K\n2000M\n1G\n`.
- `-hs`, input `1m\n2K\n1k\n1M\n1g\n1G\n1R\n1Q\n`:
  GNU 8.30 status 0, stdout `1m\n1g\n1R\n1Q\n1k\n2K\n1M\n1G\n`.
- `-hfs`, input `2m\n1K\n1M\n`: status 0, stdout `1K\n1M\n2m\n`.
- `-hsu`, input `1k b\n1K a\n1.0K c\n0M z\n0G a\n`:
  status 0, stdout `0M z\n1k b\n`.
- `-hn`, `-nh`, and `-k1,1hn`: status 2, stdout empty,
  stderr `/usr/bin/sort: options '-hn' are incompatible\n`.
- `-h -g`: native status 2, stderr says incompatible `-gh`; virtual `-g`
  remains rejected as unsupported, not newly implemented to imitate this diagnostic.
- `-h -n -k1,1h`, input `2G\n1M\n`: status 0, stdout `1M\n2G\n`.

## Results

- RED before any product edit: `TSX_DISABLE_CACHE=1 node --import tsx
  packages/safe-bash/tests/commands/sort-human-numeric.test.ts` exited 1:
  14 tests, 0 passed, 14 failed, no skips. Unsupported h returned status 2;
  conflict diagnostics differed, record admission was never reached, and the
  cancellation probe did not reject. Direct test duration: 25.423 ms.
- Sandboxed isolated `node --test --test-concurrency=1` initially reported only
  a child failure without diagnostics. Approved outside-sandbox retry with
  `--test-reporter=dot` independently reported the same 14 assertion failures.
  This infrastructure attempt is separate from the concrete RED above.
- Initial GREEN, same direct command and original 14 tests: exit 0, 14 passed,
  0 failed/skipped; 38.176 ms. No expected results were weakened after RED.
- Added one supplementary warmed-cache/cancellation control after that GREEN:
  the direct file then passed 15/15, 0 failed/skipped; 46.341 ms. Both global and
  single-key human descriptors were parsed once per record and still yielded
  after the cache was warm. This added test is not claimed as part of the 14-test RED.
- Focused isolated GREEN (approved outside-sandbox runner):

  ```sh
  TSX_DISABLE_CACHE=1 node --import tsx --test --test-concurrency=1 --test-reporter=spec \
    packages/safe-bash/tests/commands/sort-human-numeric.test.ts \
    packages/safe-bash/tests/commands/text.test.ts \
    packages/safe-bash/tests/commands/line-fragment-admission.test.ts
  ```

  Exit 0; **94 tests passed, 0 failed/cancelled/skipped/todo**, 842.073 ms.
  These include adjacent exact-numeric, byte ownership, input admission and
  cut/uniq regressions, not unrelated workers' feature tests.
- Post-implementation native differential: **21/21** cases matched status,
  stdout bytes and stderr bytes with GNU sort 8.30, LC_ALL=C. Each native/virtual
  result exited 0 with empty stderr. Native bounds remained 1 second, 8-KiB output,
  `--parallel=1 -S 64K`, stdin-only; largest input was 1,038 bytes. No timing or
  memory performance comparison is claimed.
- Differential inputs: a 32-record, 199-byte vector of mixed positive/negative
  suffixes, zeros, lowercase units, decimal precision, nonnumeric prefixes and
  classic units through Y; its 295-byte colon-keyed form; an 8-byte NUL/invalid-byte
  input; and four 256-digit-prefixed signed decimal values totaling 1,038 bytes.
  Arguments: `-h`, `--human-numeric-sort`, `-hs`, `-hr`, `-hrs`, `-hu`, `-hsu`,
  `-hru`, `-hfs`, `-hbs`; colon-keyed variants with inherited h, stable h, global n
  overridden by local h, global h overridden by local n, global r overridden by
  local h, local hr, mixed h/nr keys, global hn overridden by local h, and local hf;
  plus `-hz` on raw bytes and `-h` on huge decimals. Exact args/status/byte lengths
  and output SHA-256 values are preserved in the execution transcript. R/Q were
  deliberately excluded from the GNU 8.30 differential, not counted as passes.
- `git diff --check` on the three owned paths passed. Source changes remain in
  text.ts only: suffix metadata, effective h/n validation and h routing through
  the existing comparison/cache paths. Cache admission includes eight additional
  logical bytes per descriptor for the suffix rank; record/output limits and
  cancellation/ownership routes are unchanged.
- **Pending root:** exact integration-inputs registration, maintained lint,
  typecheck/build and final integration gates. No guarded lint bypass, full build,
  shared-dist mutation or full qualification claim.
