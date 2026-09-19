# Independent workbook format-section QA

1. Authenticate the frozen CPython executable and runtime distribution versions against `docs/csvkit/reference-profile.json` before reference capture.
2. Use reference-only openpyxl workbook generation to retain raw numeric caches with first/later format sections, uppercase elapsed formats, quoted elapsed tokens and escaped elapsed tokens. Capture exact csvkit stdout, stderr, status and side-file bytes into `docs/csvkit/in2csv-workbook-section-reference.json`; keep temporary generation/evidence in `out` and purge it after use.
3. Run the original in-memory argv/SDK regression with the original elapsed classifier. Verify failing exact-output and side-effect comparisons before applying the correction.
4. Apply the first-format-section correction, then run the focused workbook/in2csv domain tests, the maintained csvkit lint route and a maintained selected-workspace build closure.
5. Run the actual safe-bash Shell workbook tests against the rebuilt engine and compare exact output, status and filesystem effects. Root owns integration registration and broader workspace checks.
6. Record native versus JavaScript-only observations separately. Unmeasured numeric reader format IDs, arbitrary malformed format grammar and calendar ranges remain blockers.
