# Runner v2: physical temporary path and explicit holdout binding

Original freeze `20351e9920f89cc2a07a98eb24ac062f42be78ad` remains unchanged.
`baseline-v1/REPORT.json` preserves the complete first run: authenticated source
build passed, but Node22's permission model rejected the logical `/var` ancestor
while resolving the worker entry point. **Zero worker test bodies ran.** This
is a runner setup failure, not a product failure or noncollection observation.

`run-v2.mjs` changes temporary-path setup to realpath the newly created unique
directory before constructing the consumer path and exact read fence. It does
not allow `/var`, widen to the scratch/source tree, remove permissions, or alter
test expectations. The original `run.mjs` stays available unchanged. V2 also
authenticates worker/vectors/deny-native bytes against the exact precode commit,
records those hashes and its own runner hash, and fixes the freeze identity to
that commit rather than looking up a potentially newer history entry.

All literal vectors, one-step/abort/iterator controls and the allocation
discriminator are unchanged. The repaired runner is committed before replay;
candidate source remains baseline5137's collecting implementation. This is an
explicitly versioned fixture/setup correction, not product acceptance.
