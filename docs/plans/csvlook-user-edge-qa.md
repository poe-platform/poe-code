# csvlook user edge QA

1. Inspect the current executable descriptor, renderer, frozen Agate source/config and existing exact stdout/stderr/status captures. Preserve unrelated files and staging.
2. Compare numeric edge inputs through the literal csvlook executable under frozen CPython 3.14.2, csvkit 2.2.0, Agate 1.14.2, C locale, UTC and UTF-8. Capture native reference data separately from canonical tests; temporary tooling/evidence belongs in out.
3. First add failing in-memory regressions for validated differences. Exercise signed finite Decimal float overflow and finite precision-28 quantization failures. Fix the actual renderer used by CLI and SDK.
4. Retain the 50-case numeric differential matrix in docs/csvkit/csvlook-user-numeric-reference.json. Independently stress safe-bash per csvlook-user-stress-qa.md, comparing exact bytes, status, redirected files and unchanged source/namespace effects.
5. Run the maintained csvkit workspace tests/lint, selected safe-bash build dependency closure, focused maintained integration reporter, discovery assertions, integration lint and safe-bash typechecks uncached.
6. Capture and inspect actual safe-bash csvlook output with line numbers, grouping, rounding, numeric ellipsis and signed overflow values using the maintained screenshot command. Remove only this pass's temporary out directory after recording results.
7. Keep skipped/TODO/unqualified cases explicit. Do not add README content, stage, commit, push or publish.

Validated findings: the initial 50 native comparisons reproduced 20 differences across four numeric inputs and five precision configurations. Four original domain regressions failed before fixing scientific-text fallback for Decimal values classified infinite by Python float conversion and preserving the native InvalidOperation diagnostic on quantization overflow. An independently investigated named-file CR/NUL discrepancy was an oracle input-role mistake; native named-file output confirmed existing normalization.
