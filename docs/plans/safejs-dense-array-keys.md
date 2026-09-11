# Dense-array accounting key enumeration

## Evidence

The unchanged 600,000-element spread test timed out in the package and CI runs. Profiling identified full own-name enumeration as the dominant accounting hot line. Native probes on 600,000 numeric entries measured Object.keys at 15–41 ms versus Object.getOwnPropertyNames at 97–153 ms. A regression test confirms dense arrays currently use the full own-name route.

## Safe fast path

For unmanaged non-proxy arrays, first enumerate own enumerable keys. Native array index keys are unique and ascending. If the key at ordinal `length - 1` equals that canonical index, there must be exactly `length` enumerable own indices preceding any named keys. Those first keys therefore cover every index. Empty arrays need no index capture.

Use only that proven index prefix. Otherwise fall back to full own-name enumeration. Managed arrays keep their complete descriptor enumeration, including hidden named fields. Proxies keep their existing indexed descriptor route. Read descriptors, not indexed values, so getters are never invoked. Preserve capture before retention callbacks and all existing data-size charges.

## Verification

- Dense indices with additional hidden and enumerable named properties.
- Hidden indices with misleading named keys; sparse arrays and the maximum array index.
- Enumerable index getters remain uncalled.
- Proxy ownKeys omissions and all existing symbol/callback capture tests.
- Full interpreter and camera suites with unchanged inputs, budgets, and timeouts.
- Changed-file lint, maintained SafeJS build/import checks, and Node 18 probes.
- Isolated full-program benchmark comparison before claiming a speedup.

The rejected managed-descriptor tuple experiment is separate and is not included in this change.

## Results

All 526 focused tests passed. Changed-file lint, the 23-workspace build closure, four built-import checks, and Node 18 dense/hidden-index probes passed. Isolated spread timings were baseline 2653/2720/3162 ms versus candidate 2215/2214/2556 ms (about 18% lower mean). Camera timings were baseline 2069/2105/1919/2109 ms versus candidate 2278/1936/1915/1874 ms; these overlap and do not establish a camera speedup. Successful CI/release publication remains a separate verification step.
