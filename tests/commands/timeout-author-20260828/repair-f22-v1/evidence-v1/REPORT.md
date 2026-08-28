# Timeout F22 repaired reconstruction

Status: author-scoped F22 repair pass; independent Raman review remains required.

The candidate is coherent baseline `5137a74ec855a32d8a8860eb66b62eb44d11e290` plus the original timeout README, duration, and index blobs from `9ed9a0f14d12758713a8dc42be1ff75f0c87a36f`, and only the repaired scheduler blob from `a23867d6a42e1cb2f2e7278cf22061737a4bea9d`. The deterministic 268-entry source archive is `ee7fae20f2c3f99839893afe31b93aa4b6633e1baa36cfbde465e0394161de56`; its hash and exact source-tree inventory remained unchanged after execution, so source mutation and new source entries are checked.

The isolated build and strict selected types passed. Runtime checks passed 81/81: repair 2/2, unchanged author 14/14, sleep 27/27, and shared invocation cleanup 38/38. The exact package `e6f42dbb063044c0a0d9eaa3029ee9ef0b9ed26aabafd42c9346b18e1901c80c` was installed offline, exercised, physically moved, and exercised again. Both installed layouts returned default-clock child status 7 through an actual Shell and passed custom receiver, cancellation 124, and cooperative cleanup controls. Internal timeout leaf hashes were unchanged by the move.

The root and package subpath remain absent, and the default registry remains 77 commands without timeout. The old scheduler/source-archive/package hashes are explicitly rejected as repair bindings. No independent fixture was changed or rerun; the original 31/34 per layout is not rescored. Native and SafeJS executions are zero. This packet does not resolve the independent verifier issues or claim whole-product, parity, or superiority acceptance.
