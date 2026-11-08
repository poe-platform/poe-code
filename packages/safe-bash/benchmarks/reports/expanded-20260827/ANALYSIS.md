# Expanded comparison triage and coverage

Frozen production `bd2cacb3a20403302fd0a49441932d5522793e56`; corrected harness `0294afb6e690433aed994868e5ed437ecf58ae48`.

Corrected totals: virtual-bash **206 pass / 18 fail**; just-bash3.4.2 **155 pass / 69 fail**, each /224. Zero skips, timeouts, pending or harness/engine errors. Both pass148; both fail11; baseline alone passes7 kernel cases.

Initial191/224 versus146/224 is preserved, not accepted: correcting two oracle defects changes15/9 scores. Product source hashes match; 448/448 stdout/stderr/status/tree observations are unchanged across the two runs.

## Frozen failures to route

| Recipe | Owner | Classification and finding |
|---|---|---|
| command/realpath/relative | core / Curie | unsupported flag: --relative-to=. rejected; GNU9.7 returns the relative path |
| command/wc/words-lines | core / Curie | output formatting: GNU9.7 multi-column padding absent; counts match |
| command/wc/unicode | core / Curie | locale semantics: LC_ALL=C native -m counts six bytes; product counts five codepoints; do not relabel C as UTF-8 to pass |
| command/env/clean | core / Curie | environment enumeration profile: GNU preserves B then A insertion order here; product outputs A then B. Exact-profile mismatch, not proof POSIX mandates ordering |
| command/env/unset | core / Curie | environment propagation: nested env -u A leaks outer PATH/HOME/LANG/LC_ALL/TZ/PWD after env -i |
| command/cksum/algorithm | bytes / route via root | unsupported flag: GNU9.7 -a sha256 rejected |
| command/patch/apply | diff-patch / Faraday | unsupported flag: GNU2.8 patch -s rejected; output namespace stays unapplied |
| command/patch/dry-run | diff-patch / Faraday | unsupported flag: GNU2.8 patch -s rejected before dry-run |
| command/patch/reverse | diff-patch / Faraday | unsupported flag: GNU2.8 patch -s rejected before reverse application |
| command/stat/timestamp | metadata / Faraday | timestamp rendering: %y emits three fractional digits versus GNU9.7 nine; epoch value agrees |
| kernel/type/type | shell / Sagan | introspection profile: type -t emits command where GNU5.3 emits builtin/file; function agrees |
| kernel/executable-file/executable-file | shell / Sagan | script dispatch: executable without shebang rejected instead of Bash script fallback |
| kernel/env-shebang/env-shebang | shell / Sagan | script dispatch: #!/usr/bin/env bash rejected |
| kernel/source/source | shell / Sagan | missing builtin: source not found; later printf masks status but expected bytes/error checks fail |
| kernel/dot/dot | shell / Sagan | missing builtin: . not found; later printf masks status but expected bytes/error checks fail |
| kernel/eval/eval | shell / Sagan | missing builtin: eval not found |
| kernel/parameter/parameter | shell / Sagan | parameter expansion: combined prefix/suffix/global replacement recipe rejected at parameter expansion |
| composition/patch-hash/patch-hash | diff-patch / Faraday | unsupported flag with downstream effects: patch -s fails then later hash command succeeds; exact stderr and file/hash checks catch failure despite final exit0 |

## Actual coverage and missing scope

- Default registrations56; actual kernel18 with three overlapping registry names; bash/sh add two entrypoints: union73. Baseline registry83 and kernel40 overlap three: union120. Optional curl and SafeJS are separate, not default-count inflation.
- All53 unshadowed default plugin implementations execute, plus optional curl. The three shadowed registrations (true/false/pwd) are exercised as kernel behavior, not claimed as executed plugin code. Baseline executes48/83 registered implementations plus curl; unexecuted and baseline-only names are fully listed in corrected-bd2cacb/report.json.
- The224 declared cases contain223 unique input workloads; duplicate inputs and the2 exact-script overlaps with historical115 recipes+3 stress probes are enumerated in ANALYSIS.json. Recipes were not pruned after outcomes.
- Baseline18 rows target six names absent from its registry/kernel union (base32/cksum/mktemp/patch/realpath/xxd). They remain failures in the denominator; unsupported names are explicit, not silently skipped. The baseline also has53 union names absent from this product and not broadly tested here.
- 11 baseline failures have exact evidence consistent with public terminal byte-tag loss; those failures remain raw API mismatches, not attributed to internal cat/gzip/curl without further evidence. Controls separately demonstrate internal byte pipe/file preservation.
- Kernel cohort is29/36 versus36/36; composition11/12 versus8/12; optional local-network8/8 versus2/8. No source/dot/eval or executable-script gaps are hidden by default-registration coverage.
- Three command recipes do not exhaust flags: tar roundtrip/list/gzip-tree does not prove all header formats, hardlinks, extraction security or provider identity; metadata/table cases do not replace their independent suites. Optional SafeJS/Python/JS, remote backend capabilities, protocols and broad concurrent cancellation remain unmeasured here.

## Matched performance pilot

Three of four candidates match both engines; binary256KiB is excluded from timing because baseline returned bytes fail the native assertion, not because it is slow. Five fresh-process trials per engine, alternating order and one warmup each, produce30/30 matched measured results. Instrumentation controls24/24 pass.

| Workload | virtual-bash median ms | just-bash median ms |
|---|---:|---:|
| performance/sed-10000 | 51.086 | 113.102 |
| performance/sort-5000 | 38.022 | 5.680 |
| performance/awk-10000 | 20.899 | 36.840 |

The product is slower on sort5000; no combined speed score is reported. Raw memory/timing trials include before/after RSS, sampled peaks and process-lifetime maxRSS. Shared-host load, five repeats, sampling misses and TS-source versus installed-bundle startup/setup differences limit inference. Do not call these general speed/memory superiority results.

- Failure ownership is routing, not authorization to edit during this benchmark task. These are frozen findings, not assertions that later concurrent source is unchanged.
- Exact-profile formatting/environment order failures remain counted but are not automatically semantic/data-loss bugs.
- Native correction changes scores, not product behavior. The first run remains historical. No repeated input recipe is presented as an additional unique workflow.
- Performance pilot loads product TypeScript through tsx and baseline installed bundled JavaScript. Execution timing excludes startup, but memory includes package/transpiler/setup differences; built-ESM parity and larger cohost-controlled measurements remain follow-up.

Different-agent fairness review is pending. No full-product,72-hour or ‘much better’ achievement claim.
