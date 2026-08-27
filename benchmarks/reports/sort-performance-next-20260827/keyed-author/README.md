# Author checkpoint: one guarded numeric key

**Author evidence only; independent reviewer and root own acceptance.**
No timing, broad superiority, current whole gate, or completion claim.

## Source identity and isolation

- Full baseline product archive: `08a26051438f5c6bdde100a4fe724dbb84f6fca4`.
  Baseline text SHA256:
  `dfc9baed56564395bf90472fd505ea56a8eb5820712c0a5096d95ef2e2db47cc`.
- Frozen source + 24 canonical regressions:
  **`b4fe4c7868b7ab7067599c6f5d10e99d143aea54`**. Text SHA256:
  `9a66dc0e320c62aad86d78da9c55580cf6910a537a47db8a330e5122f63a1895`.
  That atomic commit owns only `src/commands/text.ts` and
  `tests/commands/core-sort/single-numeric-key-cache.test.ts`.
- `baseline.json` records the exact pre-edit HEAD, index, dirty paths and relevant
  input hashes. HEAD had advanced beyond the assignment's `0579a239` before
  inspection. More commits arrived during author work. The final candidate
  contains intervening committed `column/column.ts`, `column/internal.ts` and
  `shell/runtime.ts` changes versus 08a; these are not sort changes. Full-runtime
  differences must not silently be attributed to this optimization.
- No foreign staging/files were restored or committed. No dirty runtime, helper,
  root, dependency or configuration overlay enters the frozen package runs.
  The reviewer-ready marker was checked for **existence only** before editing
  text and committing. Its contents and the keyed-review subtree were not read.
  No source changes follow the source-freeze handoff.

`attempt-1/freeze.json` authenticates complete committed product source,
package/config, selected test/helper archives, emitted trees, tools and imports.
Archives select all `src` but only the named sort/IO test cohort, not every test
or maintained consumer. Root exports, package metadata and the emitted text
declaration are unchanged. No API/dependency addition or further keyed mode.

## Exact guard and accounting

Exactly **one key**, effective numeric `n`, **no effective `b` or `f`**, and no
global check `c`. A nonempty key-local flag set replaces global flags, exactly as
before: local `n` can therefore admit a key despite ignored global `b`/`f`.
Multiple keys, nonnumeric keys, effective blank/fold and check modes retain the
original path. The accepted unkeyed cache is unchanged.

The lazy invocation-local Map associates collector-owned **record identity**
with only the existing exact numeric descriptor. Misses call the unchanged
`keyBytes` and `parseNumeric`; no reimplemented extraction, numeric grammar,
floating conversion or eager preparation pass. Reverse is applied outside
descriptor comparison. Whole-record fallback, stable ties and unique comparison
remain in their original locations. No byte-ownership copy is removed or added.

Caps are **16,384 entries** and **1,048,576 conservative logical retained-string
bytes**. Admission charges **6*N + 2**, where N is the entire selected key length,
including any nonnumeric suffix. This reserves two bytes/code unit for decoded
Latin1 backing, captures/backing and normalized strings including synthetic zero;
it does not assume substring compaction. Huge selected prefixes/suffixes cannot
be charged merely for a small normalized number. Empty keys still consume an
entry and two charged bytes. Neither key byteviews nor field objects are retained.

The original record is already owned and retained by the sort's record array:
referencing it as a Map key does not copy its bytes. Its unselected prefix/suffix
is not decoded by `parseNumeric`, which copies only the selected key. Therefore
a huge record with a short selected key has a small *additional string charge*;
ordinary input memory remains governed by the unchanged input limit. Metadata
is bounded by entry count but has unmeasured engine-dependent overhead.

On cap rejection the same extraction/parser runs uncached, deterministically in
comparison order; existing hits remain usable and smaller later misses may fit.
Admission failure never rejects valid input or debits the input budget. This is
**not a heap/RSS bound**: owned input, transient field arrays/decoding/regex/padding,
Map/object overhead and engine allocation behavior are separate. Collection,
output, error precedence and cancellation/backpressure logic are unchanged;
added misses check the signal. Synchronous Array.sort has no hard-preemption or
rollback guarantee. Descriptors acquire no host resources or cleanup hooks.

## Correctness and author controls

- New canonical tests: **24/24** pass on full 08a product plus explicitly labeled
  test-only overlay before source editing. No expected-output correction.
- Candidate sort + IO cohort: **99/99**, comprising original 75 and new 24.
  Normal build and strict project-config source/selected-test typecheck pass
  both precommit and from the immutable source commit. No broad global gate.
- Original frozen **21/21** specimens pass with exact bytes/status/file effects
  in baseline, candidate, moved candidate package, baseline-instrumented and
  candidate-instrumented builds. All five observation hashes agree. Original
  workloads SHA256 remains
  `3d99fdebe7262d3fcce473e96af7ddbe6bb27b1fe17886657cddc8d32e8c0504`;
  all 28 prior manifest entries authenticate against `68f03711` unchanged.
- **15/15** cap/guard controls pass in the actual packed candidate and both
  instrumented variants. The baseline-text variant is explicitly a same-runtime
  counterfactual (candidate package with 08a text/internal instrumentation), not
  the full baseline. Full baseline separately passes frozen21. Fixture hashes
  and expected outputs freeze before cap execution; no hidden-review data used.
- Entry saturation reaches exactly 16,384 entries, with 22 uncached parses;
  unique saturation has 31 fallbacks. Exact character saturation reaches
  1,048,576 bytes / 2 entries, with 3 fallbacks. Large decimals retain 7 entries /
  1,008,140 charged bytes. Oversized selected suffix retains only 2 small entries /
  16 bytes, with 2 fallbacks. Huge unselected record backing likewise retains
  2 entries / 16 string-charge bytes, **without** fallback. Seven keyed bypass
  controls allocate no keyed cache; unkeyed `-n` retains its existing cache.

Canonical tests cover exact integers/decimals, grammar, modifier precedence,
offsets/delimiters, missing/reversed ranges, stable/reverse/unique, caps, borrowed
Buffer input, errors, backpressured-output cancellation and invocation isolation.
They do not write evidence. The original native fixture is reused as data; no
native executables or pathological-regex campaign ran. Historical 23 additional
native-dependent cases remain **not rerun**, not new passes. The old 8,670-test
full gate remains evidence for its old source only. The 48 prior ineligible
baseline mismatches and original 720-call denominator remain unchanged.

## Operation counts, not elapsed-time evidence

Same frozen numeric-key-8000 recipe, one untimed call per variant:

| Operation | Full 08a baseline | Candidate |
|---|---:|---:|
| Key extractions / exact numeric parses | 164,900 | 8,000 |
| Field-object preparations | 494,700 | 24,000 |
| Numeric comparisons | 82,450 | 82,450 |
| Full-record bytes scanned for fields | 3,230,564 | 156,670 |
| Selected numeric input-copy bytes | 613,178 | 29,780 |
| Fraction padEnd calls | 7,998 | 7,998 |
| Keyed cache entries / charged bytes | none | 8,000 / 194,680 |

156,900 hits avoid repeated extraction/parsing. Logical operation/allocation-site
counts are not profiler-measured allocations, live heap or speed predictions.
Key/byte/numeric comparator, padding, collector and output counters agree across
all21. The entire numeric-stable-8000 counter map is unchanged: 8,000 parses,
177,764 hits, 92,882 comparisons, 797,170 cache-charge bytes. Historical pipeline
still has zero numeric parses; its separate gap is unresolved.

## Reproduction, attempts and cleanup

`capture.mjs` is a narrow adaptation of the accepted author's read-only tooling;
it reuses the original frozen21 worker, changing only instrumented-variant naming.
`caps.mjs`/`cap-worker.mjs` reuse that earlier bounded control structure with this
stage's own small recipes. Instrumentation exists only in isolated text/internal
copies; the product has no profiler or global hook. Frozen21 instrumentation uses
normal builds; cap instrumented modules use recorded ES2023/ES2022 transpilation.

Actual `npm pack --ignore-scripts` tarball is preserved as
`attempt-1/candidate-package.tgz`, SHA256
`5fdb294d35abe5d09897263d5c1b4a3d87ccaac4107d485bed73251a587a3161`.
The moved package has no dependency link and was imported away from the build.
Every loaded file and import is pinned. Post-run tree enumeration checks both
original entries **and added entries** within loaded trees; the external tooling
node_modules symlink is deliberately excluded, with selected tool hashes recorded
separately. This is not append-proof authentication of all installed tooling.

Node22.22.2, TypeScript5.9.3, Darwin arm64. Load snapshots are preserved; shared
host load was elevated. **No paired wallclock run was authorized or performed.**
TAP durations are runner diagnostics only. Node workers have 512MiB V8 heap flags,
90s watchdogs, 8MiB output bounds, and operation workers additionally have 60s CPU
guards plus 5s cooperative exec aborts. Heap flags are not RSS limits. Every Shell
is disposed, timers cleared and owned child handles reaped. Both captures verify
loaded-tree integrity and remove only their own fresh scratch trees. No survivors,
services, installs, uploads, broad kills or worktree restoration.

`validation/initial-types-failure` preserves the first author harness failure:
the ad-hoc tsc invocation accidentally included default DOM declarations, causing
an existing WebDAV `RequestInit.duplex` mismatch. Runtime99 and normal build had
passed. The wrapper switched to the unchanged project tsconfig (ES2023/node);
no product, test assertion or fixture changed. Both failed and successful command
receipts, source snapshots and logs remain; omitted scratch tar bytes are
reproducible from the recorded immutable Git inputs plus labeled owned overlays.
Precommit overlays are not represented as frozen-package evidence.

Capture scripts require `--capture` and a fresh owned directory; never overwrite
these captures. `seal.mjs` defaults to read-only verification, including rejection
of new entries. Author counts do not establish independent acceptance, public
consumer inventory completeness, deployed-service behavior or superiority.
