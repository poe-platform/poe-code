# Cache verified directory membership

Two repository lint attempts during issue 688 reached the existing 600-second
supervision limit without a result. A native sample attributed about 67% of
sampled main-thread stacks to directory reads. Concurrent work prevents a clean
comparison with the earlier 363.79-second completed run.

Keep every fresh directory read and byte-equality comparison. Reuse the Set
already constructed for duplicate-name validation alongside the bounded decoded
directory cache, so exact-name checks no longer scan the entire string array.
Preserve cache eviction, entry/byte bounds, canonical spelling, identity checks,
receipt handling, and outward array copies. Do not add exclusions or raise caps.

The failing regression observed 12 linear membership scans for 12 children.
After the change, the same operation retains 148 metadata operations and 14
directory reads while eliminating those scans. All 278 focused lint tests pass,
including same-length name mutation controls. Independent review approved the
cache lifecycle and unchanged observations.

An isolated 30,000-name benchmark with 10,000 hit/miss queries measured arrays at
1,434–1,640 ms and Set lookups at 0.52–1.31 ms. A complete 400-file in-memory
guard traversal showed no clear gain: approximately 60–80 ms before and 60–66 ms
after, with identical 4,416 metadata operations. This change does not establish
that the repository lint timeout is solved. Full unit and maintained lint gates
remain required before delivery.

The first maintained run after the change completed in 407.58 seconds within
the unchanged supervision limits. It linted all 10,543 configured files with
3,243,665 metadata operations and complete receipt handling. It exited 1 for
50 errors and one warning in the new compression implementation and generated
artifacts; completion is not a clean gate. A two-second native sample still
showed directory reads in about half of the main-thread stacks. This is evidence
of completion under the limit, not an isolated end-to-end speedup measurement.
