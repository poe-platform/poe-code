# Exact candidate source review

Candidate: `08a26051438f5c6bdde100a4fe724dbb84f6fca4`.
Prechange: `dce6e3824d6de6d03490a531cf2bc7d2d279bb8c`.
Root routed the full candidate only after separately frozen v2 baseline replay.

The sort change is confined to text.ts. The decimal parser body is extracted
without altering its regular expression, Latin1 input copy, leading-zero and
trailing-fraction-zero normalization, negative-zero handling, or decimal-prefix
grammar. Descriptor comparison retains sign, whole-length/lexical comparison,
fraction padding and sign reversal. There is no Number/parseFloat conversion.

The invocation-local map is constructed only with global numeric mode, no keys,
and none of b/f/c. Every explicit key is excluded, including one numeric key.
Default plain sorting constructs no descriptor cache. Effective key flags,
byte offsets and key extraction are otherwise unchanged. Reverse and whole-byte
fallback remain outside the descriptor parser; stable/unique ties still retain
the first original equivalent record. The unique pass uses the same local map.

Both admission conditions precede parsing/publication into the map. The 16,384
entry limit applies even to zero-length records. The independent second budget
is 1,048,576 conservative retained bytes, charged as `6 * bytes.length + 2` per
descriptor. This is **not** a cap on only the normalized numeric prefix: it also
charges a potentially large nonnumeric suffix whose Latin1 backing a substring
might retain. Six times full input length plus two conservatively covers logical
string payloads even with two-byte string storage and separately normalized
whole/fraction strings; it does not purport to measure VM object/Map overhead,
allocator slack, RSS or transient parsing allocations. Entry count bounds that
otherwise independent metadata growth. Existing owned record storage is still
separately governed by the unchanged 32MiB sort/record limits.

On saturation, the existing exact parser is called without caching. An oversized
record does not consume the budget and does not reject valid input. A cache hit
returns the stored descriptor; misses check cancellation before parsing. There
is no global cache, cache escape, export, dependency or host capability change.
There is no new synchronous-sort preemption guarantee. The full collector,
retained-fragment copies, admission limits, check-mode, error diagnostics and
output/backpressure code are unchanged.

The full candidate also changes grep-aliases/index.ts and shell/runtime.ts
relative to the prechange commit. source-review.json records exact before/after
hashes for every selected source/config input and the three changed source paths.
Actual package replay therefore qualifies these **full committed snapshots**, not
a sort-only whole-tree experiment. No counterfactual was needed or substituted;
the local text.ts review and separately instrumented operation observations are
not a performance attribution claim for the whole tree.
