# Timeout author reconstructed validation

Status: author-scoped pass, not independent Raman acceptance.

The candidate is the exact coherent77 baseline 5137a74ec855a32d8a8860eb66b62eb44d11e290 plus only the four timeout module blobs from 9ed9a0f14d12758713a8dc42be1ff75f0c87a36f. The deterministic source archive hash is 1a7f280f4f309af3dcc8f3a7ec629b95dddbc65d180bc45c9911ff64523d6ded; the same hash remained after execution, and its 268 inputs contain no symlinks, non-regular entries, or instruction files.

The reconstructed build, 14 author cases, strict source/harness types, sleep neighbor, shared invocation-cleanup neighbors, and owned-output neighbor passed. The packed and locally installed package was moved and rechecked. Its internal leaf exposes three runtime factories, while the root and package subpath remain absent and the default registry remains 77 without timeout.

The author did not execute Raman's 32 families or 70 vectors, did not execute the 12 native rows, and did not replay SafeJS. The prior SafeJS 25/25 record is root-reported only. Cooperative timeout still cannot preempt a blocked event loop, an ignored signal, opaque host work, a stalled conforming clock, or nonsettling cleanup.
