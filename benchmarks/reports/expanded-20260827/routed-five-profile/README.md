# Routed five: separate original and scratch-aligned replay

Captured August27,2026 at committed production
`b43c994e1bf94bccef78d1f1ff05228993f19e01`. Source is extracted by git archive;
dirty source, including Sagan's in-progress replaceEnv changes, is excluded.
The replay does not edit recipes, expectations, production or existing harnesses.

| Profile | Committed harness | Virtual result | just-bash3.4.2 |
|---|---|---|---|
| Original corrected native | 0294afb6e690433aed994868e5ed437ecf58ae48 | 4/5 pass,1 fail | 0/5 pass,5 fail |
| Separate scratch-aligned | d1b10a375a13f031f9f604a64395cd507f21a071 | 5/5 pass,0 fail | 0/5 pass,5 fail |

No skips, capture errors or timeouts. The five rows are command/patch/apply,
command/patch/dry-run, command/patch/reverse, command/stat/timestamp and
composition/patch-hash/patch-hash. This is not a new full224 score.

Every expected stdout/stderr/status is identical across profiles. Every product
stdout/stderr/status/fixture effect is identical across profiles for both
engines (10 paired observations). Only the native patch/dry-run expected
namespace changes: the old empty fixture-local tmp directory disappears under
the separately documented preexisting external scratch role. Current virtual
stdout/stderr/status match all five native rows under both profiles; the sole
old-profile mismatch is that directory. No field is ignored or normalized here.

Faraday's patch source matches96564fe99fdfb36392fbbb3afd1cf070cd608201 and stat
source matches386196b in this frozen snapshot. Their real source fixes are
separate from the scratch setup correction. The original206/224 with18 failures,
old just-bash155/224, original five-row4/5 and all native captures are untouched.
The baseline's five failures remain measured, not excluded by selecting only
matching engines. No superiority or comprehensive option/backend claim follows.

`b43c994.json` contains exact scripts, recipe hashes, expected and actual byte
encodings/status/entries, per-field comparisons, both golden hashes, all frozen
product source hashes and installed baseline version/bundle/lock hashes.
The existing scratch controls/capture are reused; there is no new native capture.

Reproduce into a new file from the repository root:

```sh
node benchmarks/reports/expanded-20260827/routed-five-profile/replay.mjs \
  b43c994e1bf94bccef78d1f1ff05228993f19e01 /tmp/routed-five-profile-new.json
```

The report refuses overwrite. Temporary snapshots are owned and cleaned by the
runner; cached dependencies are linked, not installed. Product commands do not
spawn native processes. Existing unowned native temporary directories remain.
The env six-row replay is a distinct gate and waits for committed runtime
integration; this replay is not evidence for that pending change.
