# Serial shell-stress setup batching

## Change

Run ordinary compatibility fixtures in batches of at most eight, serially in
one child process. Every case creates and disposes its own Shell/filesystem.
Every batch takes fresh before/after source censuses; no result cache or retries.
Keep all 126 original named cases and assertions: 72 differential, five syntax,
and 49 holdout cases. New batch parents are not extra compatibility coverage.

Leave worker and concurrency settings unchanged. Retain per-case watchdogs,
the five-second outer child deadline, and the existing output ceiling. A failed
protocol or hard deadline fails every affected batch case instead of retrying.
Future heavier fixtures may need smaller batches because the outer limits are
shared. Process-global module state is shared, unlike Shell/filesystem state.

## Evidence

The earlier profile measured approximately 58s for the 72 differential cases
and 58s for 49 holdout cases. Two reversed-order serial passes now measure
14.349s and 14.099s combined. These timings cover 121 cases, excluding the five
syntax cases and provenance check; the baseline was not remeasured on this head.

New helper tests fail before the batch API exists, then pass with checks for
fresh censuses, bounded launches, bad requests, changed source, timeouts,
unexpected stderr, missing/reordered outcomes, isolated state, raw bytes, and
independent failures. Parent validation runs both complete compatibility files,
the helper/process tests, and all unchanged lifecycle probes: 180 test entries
pass in 38.020s, with zero failures or skips. No full CI timing claim yet.
