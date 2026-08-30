# Expanded comparison — frozen evidence

Source revision: `bd2cacb3a20403302fd0a49441932d5522793e56`; just-bash `3.4.2`.

| Engine | Pass | Fail | Timeout | Harness/engine error | Total |
|---|---:|---:|---:|---:|---:|
| virtual-bash | 191 | 33 | 0 | 0 | 224 |
| just-bash | 146 | 78 | 0 | 0 | 224 |

Both pass: 139; both non-pass: 26. No skips/pending are passes.
Actual registry execution: virtual 53/53 unshadowed default plugins; baseline 48/83 registered names.
Instrumentation controls: 24/24. Performance eligible: 3/4; failed measured trials: 0.

## Failures (unchanged native expectation)

| Recipe | virtual-bash | just-bash |
|---|---|---|
| command/pwd/logical | fail: stdout | fail: stdout |
| command/pwd/physical | fail: stdout | fail: stdout |
| command/pwd/symlink | fail: stdout | fail: stdout |
| command/dirname/nul | pass | fail: stdout |
| command/printf/binary | pass | fail: stdout |
| command/mkdir/mode | pass | fail: stderr, exitCode, entries |
| command/touch/reference | pass | fail: stdout |
| command/cp/preserve-link | pass | fail: stdout, stderr, exitCode, entries |
| command/rm/empty-directory | pass | fail: stderr, exitCode, entries |
| command/ln/hardlink | pass | fail: stdout, entries |
| command/readlink/no-newline | pass | fail: stdout, stderr, exitCode |
| command/readlink/canonical | fail: stdout | fail: stdout |
| command/realpath/existing | fail: stdout | fail: stdout, stderr, exitCode |
| command/realpath/missing-tail | fail: stdout | fail: stdout, stderr, exitCode |
| command/realpath/relative | fail: stdout, stderr, exitCode | fail: stdout, stderr, exitCode |
| command/cat/binary-stdin | pass | fail: stdout |
| command/head/negative | pass | fail: stdout, stderr, exitCode |
| command/tail/bytes | pass | fail: stdout |
| command/wc/words-lines | fail: stdout | fail: stdout |
| command/wc/unicode | fail: stdout | fail: stdout |
| command/tee/file | pass | fail: stdout |
| command/sort/nul-unique | pass | fail: stdout, stderr, exitCode |
| command/uniq/counts | pass | fail: stdout |
| command/cut/bytes | pass | fail: stdout, stderr, exitCode |
| command/cut/complement | pass | fail: stdout, stderr, exitCode |
| command/env/clean | fail: stdout | fail: stdout |
| command/env/unset | fail: stdout | fail: stdout |
| command/env/nested | pass | fail: stdout |
| command/xargs/batch | pass | fail: stdout, stderr, exitCode |
| command/xargs/replace | pass | fail: stdout, stderr, exitCode |
| command/find/nul | pass | fail: stdout, stderr, exitCode |
| command/rg/fixed | pass | fail: stdout, exitCode |
| command/base64/decode | pass | fail: stdout |
| command/base32/encode | pass | fail: stdout, stderr, exitCode |
| command/base32/decode | pass | fail: stdout, stderr, exitCode |
| command/base32/wrap | pass | fail: stdout, stderr, exitCode |
| command/xxd/plain | pass | fail: stdout, stderr, exitCode |
| command/xxd/reverse | pass | fail: stdout, stderr, exitCode |
| command/xxd/layout | pass | fail: stdout, stderr, exitCode |
| command/od/hex | pass | fail: stdout |
| command/od/decimal | pass | fail: stdout |
| command/od/skip-count | pass | fail: stdout |
| command/cksum/stdin | pass | fail: stdout, stderr, exitCode |
| command/cksum/files | pass | fail: stdout, stderr, exitCode |
| command/cksum/algorithm | fail: stdout, stderr, exitCode | fail: stdout, stderr, exitCode |
| command/gzip/roundtrip | fail: stdout | fail: stdout |
| command/gzip/replace | fail: stderr, entries | fail: stderr, entries |
| command/gunzip/stdin | fail: stdout | fail: stdout |
| command/gunzip/keep | fail: stderr, entries | fail: stderr, entries |
| command/zcat/stdin | fail: stdout | fail: stdout |
| command/zcat/file | fail: stdout, stderr | fail: stdout, stderr |
| command/zcat/multiple-members | fail: stdout, stderr | fail: stdout, stderr |
| command/diff/unified | pass | fail: stdout, stderr |
| command/diff/ignore-space | pass | fail: stderr, exitCode |
| command/patch/apply | fail: stderr, exitCode, entries | fail: stderr, exitCode, entries |
| command/patch/dry-run | fail: stderr, exitCode, entries | fail: stderr, exitCode, entries |
| command/patch/reverse | fail: stderr, exitCode, entries | fail: stderr, exitCode, entries |
| command/chmod/recursive-reference | pass | fail: stderr, exitCode, entries |
| command/stat/follow | pass | fail: stdout, stderr, exitCode |
| command/stat/timestamp | fail: stdout | fail: stdout |
| command/mktemp/file | pass | fail: stdout, stderr, exitCode |
| command/mktemp/directory | pass | fail: stdout, stderr, exitCode |
| command/mktemp/suffix-dry-run | pass | fail: stdout, stderr |
| command/paste/nul-shared | pass | fail: stdout, stderr, exitCode |
| command/comm/totals | pass | fail: stdout, stderr, exitCode |
| command/join/outer | pass | fail: stdout, stderr, exitCode |
| command/join/duplicate | pass | fail: stdout, stderr, exitCode |
| kernel/cd/cd | fail: stdout | fail: stdout |
| kernel/type/type | fail: stdout | pass |
| kernel/executable-file/executable-file | fail: stdout, stderr, exitCode | pass |
| kernel/env-shebang/env-shebang | fail: stdout, stderr, exitCode | pass |
| kernel/source/source | fail: stdout, stderr | pass |
| kernel/dot/dot | fail: stdout, stderr | pass |
| kernel/eval/eval | fail: stdout, stderr, exitCode | pass |
| kernel/parameter/parameter | fail: stdout, stderr, exitCode | pass |
| composition/text-filter/text-filter | pass | fail: stdout |
| composition/binary-roundtrip/binary-roundtrip | fail: stdout, entries | fail: stdout, entries |
| composition/patch-hash/patch-hash | fail: stdout, stderr, entries | fail: stdout, stderr, entries |
| composition/find-xargs/find-xargs | pass | fail: stdout, stderr |
| network/curl/get | pass | fail: stdout |
| network/curl/post-stdin | pass | fail: stdout, exitCode |
| network/curl/post-file | pass | fail: stdout |
| network/curl/json | pass | fail: stdout, stderr, exitCode |
| network/curl/redirect | pass | fail: stdout |
| network/curl/fail-body | pass | fail: stdout, stderr, exitCode |

## Limits

- 224 additional recipes, not full Bash or utility coverage; three declared option families per default command do not establish complete support.
- Primary Bash5.3/coreutils9.7 plus individually hashed mixed native tool profiles, not uniformly GNU. Historical118 and prior19-unshadowed-plugin cohort unchanged.
- Exact stdout/stderr/status and /fixture tree bytes/types/links; selected mode assertions. No full timestamp, ownership, outside-root, backend protocol, concurrency or network-confinement proof.
- Public stdout byte-boundary differences retained; transport controls distinguish internal pipes/files from returned API encoding. No encoding heuristic or silent unsupported skip.
- Five performance repeats, one warmup per fresh child, alternating order, no instrumentation. Execution time excludes import/setup/snapshot; maxRSS is process-lifetime including setup/warmup. Sampled peaks can miss synchronous spikes; shared-host load and unequal implementation/lazy-load costs prevent general superiority claims.
- Baseline-only tools/kernel names are inventory gaps, not denominator-free passes; optional Python/JS/SafeJS and remote backends are unmeasured here.
- Different-agent fairness review pending. Product/72-hour/much-better requirement remains unproven.

Raw observations: functional.json; timings/memory: performance.json; byte API controls: transport-controls.json; exact inventory/source/oracle/runtime identities: report.json.
