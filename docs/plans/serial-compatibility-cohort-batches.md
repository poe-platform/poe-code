# Serial compatibility cohort batches

Reuse the bounded serial shell batch helper in the remaining-gap, diagnostic
profile and input-boundary compatibility cohorts. Each case retains its name,
order, independent shell/filesystem, oracle and assertion expressions. Keep the
optional diagnostic profiles and source/reference guards. Do not alter evidence,
timeouts, concurrency settings or native-reference observations.

Full-file local measurements, before and after:

| Cohort | Retained cases | Before | After |
| --- | ---: | ---: | ---: |
| Remaining gaps | 11 | 11.344s | 3.338s |
| Diagnostic profile | 88 | 74.954s | 16.608s |
| Input boundaries | 12 | 13.014s | 3.644s |
| Total | 111 | 99.312s | 23.589s |

All 111 original cases pass with the same 14 assertion expressions. Spawn-count
controls fail before batching and pass afterward. Strict TypeScript checks pass.
This saves 75.722s locally; combined CI runtime remains to be measured.
