# Independent complete baseline inventory

The V3 inventory independently reconciles all 53876 files and 102926 exact filename/mode variant IDs across 216 selected reports. No omitted or duplicate variants, metadata errors, or file execution errors were observed. Raw results: **93157 passed, 6451 failed, 3318 unsupported**. Every nonpass remains in the detailed inventory; runner success is false.

Manifest `b974f63562bfa3431a18d4da5113a2a0f05ee919c08016df82d5eab78c99bacd`, source SHA `f314e261c96e444b8fc983117864462171db5bc4`, source-content SHA-256 `b51f268c45c0643879c5c46eb088618a8db0415020c65e2e32ae47d8b928c9cc`. Node `v22.23.2`, ICU `78.2`; timeout 3000 ms. Complete headers, source hashes, runtime/configuration, selected filenames, mode sets and summary counts were cross-checked independently against the manifest. Historical V1/V2 reports and diagnostic probes are excluded.

The conservative module feature gate produced 1153 explicit module nonpasses; 729 related parse-negative variants remained outside that execution gate (729 passed). This does not qualify module loading.

Unhandled rejection policy remains unqualified: 50 synchronous and 24 asynchronous nonpasses. 6 contain assertion diagnostics requiring additional semantic review. These raw failures are not blanket ECMAScript defects; see [sample contracts and counterexamples](../mismatch-samples.md).

## Retained reasons and host diagnostic codes

| Reason/code | Variants |
| --- | ---: |
| worker-wall-timeout | 4546 |
| module | 1996 |
| unexpected-throw | 1336 |
| shared-memory | 974 |
| agent | 224 |
| async-failure | 196 |
| budgetExceeded | 191 |
| wrong-phase | 100 |
| IsHTMLDDA | 84 |
| unhandled-rejection | 74 |
| gc | 22 |
| blocking-mode | 18 |
| reentry | 6 |
| wrong-error-type | 2 |

## Primary repair or qualification owners

| Task owner | Nonpasses |
| --- | ---: |
| qualify-resource-and-timing-behavior | 4596 |
| qualify-source-modules | 1996 |
| qualify-shared-memory | 1216 |
| qualify-builtins | 688 |
| qualify-language-semantics | 334 |
| qualify-async-job-order | 246 |
| verify-conformance-oracles | 215 |
| qualify-intl-environment-matrix | 158 |
| qualify-binary-memory | 101 |
| qualify-environment-contract | 84 |
| qualify-weak-lifetimes | 70 |
| qualify-regexp-semantics-and-cost | 60 |
| qualify-exotic-object-invariants | 5 |

## Largest actionable groups

| Category | Task owner | Reason/code | Variants |
| --- | --- | --- | ---: |
| budget-or-timeout | qualify-resource-and-timing-behavior | worker-wall-timeout | 4546 |
| capability-boundary | qualify-source-modules | module | 1996 |
| capability-boundary | qualify-shared-memory | shared-memory | 974 |
| semantic-candidate-unvalidated | qualify-builtins | unexpected-throw | 258 |
| capability-boundary | qualify-shared-memory | agent | 224 |
| semantic-candidate-unvalidated | qualify-async-job-order | async-failure | 162 |
| harness-qualification | verify-conformance-oracles | budgetExceeded | 141 |
| semantic-candidate-unvalidated | qualify-builtins | unexpected-throw | 120 |
| capability-boundary | qualify-environment-contract | IsHTMLDDA | 84 |
| semantic-candidate-unvalidated | qualify-builtins | unexpected-throw | 79 |
| semantic-candidate-unvalidated | qualify-async-job-order | unexpected-throw | 78 |
| unqualified-rejection-policy | verify-conformance-oracles | unhandled-rejection | 74 |
| semantic-candidate-unvalidated | qualify-builtins | unexpected-throw | 70 |
| semantic-candidate-unvalidated | qualify-language-semantics | unexpected-throw | 68 |
| semantic-candidate-unvalidated | qualify-builtins | unexpected-throw | 64 |
| semantic-candidate-unvalidated | qualify-regexp-semantics-and-cost | unexpected-throw | 52 |
| budget-or-timeout | qualify-resource-and-timing-behavior | budgetExceeded | 50 |
| semantic-candidate-unvalidated | qualify-intl-environment-matrix | unexpected-throw | 50 |

Each detailed entry includes original diagnostics, feature metadata, pinned upstream fixture, hashes, target-mapping disposition, owner/source surface and an actual neighboring passing control when one exists. Controls sharing only an ancestor directory are navigation aids, not equivalent semantic coverage. Feature counts overlap because tests may declare multiple features; path counts partition by the recorded path prefix.

Budget/deadline failures reflect unchanged caps under recorded shared-machine load; they do not establish a language semantic defect. Semantic candidates still require reproduction and primary-contract validation before runtime repair. The published target remains ECMA-262 edition 16 and ECMA-402 edition 12 plus the expressly tracked newer APIs; proposal fixtures are not silently folded into that target. All fixtures remain counted in this full-corpus baseline.

The compressed detailed inventory is `independent-mismatch-inventory.json.gz`; `inventory-archive-receipt.json` records compressed/uncompressed hashes and roundtrip verification. Use [historical replay](../historical-report-replay.md) to verify archived accounting without claiming a later checkout was tested.
