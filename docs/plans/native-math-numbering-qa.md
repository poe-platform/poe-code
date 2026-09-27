# Native math and numbering process QA

Validate default-stack Node execution and actual package imports separately from fast unit coverage. Run after changes to native math, retained numbering, public dispatch, or document admission.

1. Run `npm run build`.
2. For each scenario below, run from the repository root:
   `node --import tsx packages/docx/tests/fixtures/deep-numbering-native-math-worker.ts <strict-or-transitional> <radicals> <route> <action> <kind> <prefix> <carrier> <codec>`.
   Map `strict=true` to `strict` and `false` to `transitional`.
3. Require exit zero and the returned identity plus all three preservation flags to be true. The worker asserts exact math and opaque numbering preservation, public dispatch and retention, source/destination immutability, dirty XML framing, encoding/BOM, RTL, and opaque signature interaction. Edit cases reopen the archive and inspect the public model; dry runs publish no archive.
4. Use the normal Node stack and package imports. Do not raise unit deadlines or substitute host writes for the worker's in-memory files. Keep temporary output in `/out` and purge after verification.

| Sample | Strict | Kind | Prefix | Carrier | Codec | Route | Action | Radicals |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | False | docx | w | direct | utf8 | sdk | edit | 32 |
| 1 | False | docx | w | choice | utf8 | sdk | edit | 1280 |
| 2 | False | docx | w | fallback | utf8 | sdk | edit | 1792 |
| 3 | False | docx | w | process | utf8 | sdk | dry | 32 |
| 4 | False | docx | alternate | direct | utf8 | sdk | dry | 1280 |
| 5 | False | docx | alternate | choice | utf8 | sdk | dry | 1792 |
| 6 | False | docx | alternate | fallback | utf8 | sdk-batch | edit | 32 |
| 7 | False | docx | alternate | process | utf8 | sdk-batch | edit | 1280 |
| 8 | False | docx | default | direct | utf8 | sdk-batch | edit | 1792 |
| 9 | False | docx | default | choice | utf8 | sdk-batch | dry | 32 |
| 10 | False | docx | default | fallback | utf8 | sdk-batch | dry | 1280 |
| 11 | False | docx | default | process | utf8 | sdk-batch | dry | 1792 |
| 12 | False | dotx | w | direct | utf8 | cli | edit | 32 |
| 13 | False | dotx | w | choice | utf8 | cli | edit | 1280 |
| 14 | False | dotx | w | fallback | utf8 | cli | edit | 1792 |
| 15 | False | dotx | w | process | utf8 | cli | dry | 32 |
| 16 | False | dotx | alternate | direct | utf8 | cli | dry | 1280 |
| 17 | False | dotx | alternate | choice | utf8 | cli | dry | 1792 |
| 18 | False | dotx | alternate | fallback | utf8 | cli-batch | edit | 32 |
| 19 | False | dotx | alternate | process | utf8 | cli-batch | edit | 1280 |
| 20 | False | dotx | default | direct | utf8 | cli-batch | edit | 1792 |
| 21 | False | dotx | default | choice | utf8 | cli-batch | dry | 32 |
| 22 | False | dotx | default | fallback | utf8 | cli-batch | dry | 1280 |
| 23 | False | dotx | default | process | utf8 | cli-batch | dry | 1792 |
| 24 | True | docx | w | direct | bom | sdk | edit | 32 |
| 25 | True | docx | w | choice | bom | sdk | edit | 1280 |
| 26 | True | docx | w | fallback | bom | sdk | edit | 1792 |
| 27 | True | docx | w | process | bom | sdk | dry | 32 |
| 28 | True | docx | alternate | direct | bom | sdk | dry | 1280 |
| 29 | True | docx | alternate | choice | bom | sdk | dry | 1792 |
| 30 | True | docx | alternate | fallback | bom | sdk-batch | edit | 32 |
| 31 | True | docx | alternate | process | bom | sdk-batch | edit | 1280 |
| 32 | True | docx | default | direct | bom | sdk-batch | edit | 1792 |
| 33 | True | docx | default | choice | bom | sdk-batch | dry | 32 |
| 34 | True | docx | default | fallback | bom | sdk-batch | dry | 1280 |
| 35 | True | docx | default | process | bom | sdk-batch | dry | 1792 |
| 36 | True | dotx | w | direct | bom | cli | edit | 32 |
| 37 | True | dotx | w | choice | bom | cli | edit | 1280 |
| 38 | True | dotx | w | fallback | bom | cli | edit | 1792 |
| 39 | True | dotx | w | process | bom | cli | dry | 32 |
| 40 | True | dotx | alternate | direct | bom | cli | dry | 1280 |
| 41 | True | dotx | alternate | choice | bom | cli | dry | 1792 |
| 42 | True | dotx | alternate | fallback | bom | cli-batch | edit | 32 |
| 43 | True | dotx | alternate | process | bom | cli-batch | edit | 1280 |
| 44 | True | dotx | default | direct | bom | cli-batch | edit | 1792 |
| 45 | True | dotx | default | choice | bom | cli-batch | dry | 32 |
| 46 | True | dotx | default | fallback | bom | cli-batch | dry | 1280 |
| 47 | True | dotx | default | process | bom | cli-batch | dry | 1792 |

All 48 native scenarios were executed successfully on 26 September 2026 alongside the same 48 unit scenarios with dependencies loaded once.
