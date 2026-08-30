# All53 unchanged controls — raw and reviewed provenance

One process only. The original raw records are not rewritten. PASS rows after the
first import refusal remain observed but do not satisfy the required fatal-stop
discipline. Intended stream operations never ran; their wrappers did run and fail.

| # | Original ID | Role | Raw | Reviewed | Qualification |
|---:|---|---|---|---|---|
|1|`D01-committed-seals-and-selected-source`|DATA|PASS|PASS|before import refusal|
|2|`D02-five-tools-calls-aliases-OS-pairs`|DATA|PASS|PASS|before import refusal|
|3|`S01-source-overlay-route-and-cleanup-boundaries`|SOURCE|PASS|PASS|before import refusal|
|4|`V01-cross-realm-exact-data`|SYNTHETIC|PASS|PASS|before import refusal|
|5|`V02-reject-malformed-role`|SYNTHETIC|PASS|PASS|before import refusal|
|6|`V03-reject-malformed-role`|SYNTHETIC|PASS|PASS|before import refusal|
|7|`V04-reject-malformed-role`|SYNTHETIC|PASS|PASS|before import refusal|
|8|`V05-reject-malformed-role`|SYNTHETIC|PASS|PASS|before import refusal|
|9|`V06-reject-malformed-role`|SYNTHETIC|PASS|PASS|before import refusal|
|10|`V07-reject-malformed-role`|SYNTHETIC|PASS|PASS|before import refusal|
|11|`V08-reject-malformed-role`|SYNTHETIC|PASS|PASS|before import refusal|
|12|`V09-reject-malformed-role`|SYNTHETIC|PASS|PASS|before import refusal|
|13|`V10-reject-malformed-role`|SYNTHETIC|PASS|PASS|before import refusal|
|14|`T01-table71-call-env-input-owned-cleanup`|STUB|PASS|PASS|before import refusal|
|15|`T02-write`|STUB|PASS|PASS|before import refusal|
|16|`T02-spawn`|STUB|PASS|PASS|before import refusal|
|17|`T02-cleanup-only`|STUB|PASS|PASS|before import refusal|
|18|`T02-primary-plus-cleanup`|STUB|FAIL|FAIL|before import refusal|
|19|`T02-late-cleanup`|STUB|PASS|PASS|before import refusal|
|20|`T03-shared-success`|STUB|PASS|PASS|before import refusal|
|21|`T03-shared-foreign-parent`|STUB|PASS|PASS|before import refusal|
|22|`T03-shared-child-acquisition`|STUB|PASS|PASS|before import refusal|
|23|`T03-shared-primary-plus-foreign`|STUB|FAIL|FAIL|before import refusal|
|24|`P01-patch-scratch-success`|STUB|PASS|PASS|before import refusal|
|25|`P01-patch-scratch-throw`|STUB|PASS|PASS|before import refusal|
|26|`P01-patch-scratch-outside`|STUB|PASS|PASS|before import refusal|
|27|`P01-patch-scratch-primary-plus-cleanup`|STUB|FAIL|FAIL|before import refusal|
|28|`H01-shell-success-canary`|STUB|PASS|PASS|before import refusal|
|29|`H01-shell-outside`|STUB|PASS|PASS|before import refusal|
|30|`H01-shell-primary-plus-cleanup`|STUB|FAIL|FAIL|before import refusal|
|31|`H02-stream-success`|STUB|FAIL|HARNESS_ERROR|stream operation UNEXECUTED|
|32|`H02-stream-primary-plus-cleanup`|STUB|FAIL|HARNESS_ERROR|stream operation UNEXECUTED|
|33|`R01-git-positive`|STUB|PASS|PASS|after fatal-stop boundary; not qualified|
|34|`R01-git-wrong-hash`|STUB|PASS|PASS|after fatal-stop boundary; not qualified|
|35|`R01-git-wrong-realpath`|STUB|PASS|PASS|after fatal-stop boundary; not qualified|
|36|`R01-npm-positive`|STUB|PASS|PASS|after fatal-stop boundary; not qualified|
|37|`R01-npm-wrong-hash`|STUB|PASS|PASS|after fatal-stop boundary; not qualified|
|38|`R01-npm-wrong-realpath`|STUB|PASS|PASS|after fatal-stop boundary; not qualified|
|39|`C01-root-compiler-positive`|STUB|PASS|PASS|after fatal-stop boundary; not qualified|
|40|`C01-root-compiler-missing`|STUB|PASS|PASS|after fatal-stop boundary; not qualified|
|41|`C01-root-compiler-wrong-hash`|STUB|PASS|PASS|after fatal-stop boundary; not qualified|
|42|`C01-root-compiler-wrong-version`|STUB|PASS|PASS|after fatal-stop boundary; not qualified|
|43|`C02-build-counter-benchmark`|STUB|PASS|PASS|after fatal-stop boundary; not qualified|
|44|`C02-build-counter-production`|STUB|PASS|PASS|after fatal-stop boundary; not qualified|
|45|`R02-reporter-10-success`|STUB|PASS|PASS|after fatal-stop boundary; not qualified|
|46|`R02-reporter-10-wrong-output`|STUB|PASS|PASS|after fatal-stop boundary; not qualified|
|47|`R02-reporter-10-nonzero-with-pass`|STUB|PASS|PASS|after fatal-stop boundary; not qualified|
|48|`R02-reporter-10-late-pass-timeout`|STUB|PASS|PASS|after fatal-stop boundary; not qualified|
|49|`R02-reporter-6-success`|STUB|PASS|PASS|after fatal-stop boundary; not qualified|
|50|`R02-reporter-6-wrong-output`|STUB|PASS|PASS|after fatal-stop boundary; not qualified|
|51|`R02-reporter-6-nonzero-with-pass`|STUB|PASS|PASS|after fatal-stop boundary; not qualified|
|52|`R02-reporter-6-late-pass-timeout`|STUB|PASS|PASS|after fatal-stop boundary; not qualified|
|53|`D03-protected-read-set-postcheck`|DATA|PASS|PASS|after fatal-stop boundary; not qualified|

Raw:53 wrappers,47 PASS,6 FAIL,0 HARNESS_ERROR,0 skip,0 absent wrapper IDs.
Reviewed:4 source failures and2 harness errors;2 intended stream operations
unexecuted within those2 failed wrappers. First30:26 PASS/4 FAIL. After first
refusal:22 raw rows including1 further harness error and21 PASS observations.

No native/product/compiler/build/gate/private execution;20 actual tool controls
and5 actual script replays remain UNRUN. No retry or further GO.
