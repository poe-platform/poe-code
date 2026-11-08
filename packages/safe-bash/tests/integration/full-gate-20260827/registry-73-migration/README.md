# Two current registry fixtures: explicit73 migration

2026-08-27. Root accepted public integration316b7efe on isolated3dc0ac26;
the three additions are egrep, fgrep and column. Expr/du remain nondefault,
curl/SafeJS optional. Existing `tests/plugins/agent-commands.test.ts` declares
the full authoritative expected name set independently of implementation.

Only three `70` tokens per fixture change to `73`: title, factory count, installed
count in split/integration.test.ts and stream-format-author-stress/contracts.test.ts.
No input, expected output, optional-capability refusal, standalone-family count,
filesystem assertion, limit or consumer behavior changes. Whole-file byte
comparison enforces exactly those replacements, not a broad expected-value rewrite.

Frozen product `d4ed8322ca01482e8eb591dcfa94f5ba28f76201` was archived with regular
copied cached development dependencies; source hashes are recorded and unchanged.
No build or whole suite. Node22.22.2 direct focused tests, not the Node24 guarded
whole-gate profile. Two complete files, final attempt:

| Cohort | Pass | Fail | Skip |
| --- | ---: | ---: | ---: |
| Original unchanged assertions |24|2|0|
| Revised six count/title tokens |26|0|0|
| Only four count assertions mutated to74 |24|2|0|

Original failing test names are `actual default registry contains 70 including
split without duplicate installation` and `default factory contains70 and
standalone formatting installs exactly four without split`. Original files and
all TAP captures remain under both attempt directories. Execution trees removed.

Attempt01 also produced24/26 original and26/26 revised, but its negative-control
generator used blanket73→74 and accidentally mutated a hex output literal,
causing two additional failures (22/26). That is a **control-generator defect**,
not product or migration failure. Attempt02 narrows mutation to `length, 73)`
and checks exactly two failures; attempt01 remains preserved, not relabeled.
Independent review required; no previous8670 score changes.
