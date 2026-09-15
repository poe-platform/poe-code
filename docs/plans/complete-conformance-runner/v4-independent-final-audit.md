# V4 independent final baseline audit

The current full baseline is complete and independently reconciled. **All 102,926 enumerated variants are accounted for: 93,220 passed, 6,388 failed and 3,318 unsupported.** The maintained aggregate correctly exited **1** with `complete: true, success: false`. Accounting qualification passes; the runner does not claim conformance success.

Source SHA: `a4476e3fabf1bf5f3c492aa76f38ff0bf3d05e46`; source-content hash: `aa87050d0107c7e5c7ab7beab09ff260c65c7b119fc25d76ac294e9c6565f5b3`; manifest: `547fad76257b2e6e3d5aae1626ead11434d557f8f3d12b2b613aea238dee41a9`. The independently recomputed manifest ID matches. Test262 remains pinned at `419d3e0a2273ba01a3bfcbec423f2801425b8e93`. Runtime remains Node v22.23.2, ICU 78.2, V8 12.4.254.21-node.56, Darwin arm64. Per-variant/wall timeout is 3000 ms, worker startup allowance 10000 ms, with unchanged effective budgets, static/backend guards and no failed-variant retries.

The [final independent cross-check](baseline-v4/independent-final-crosscheck.json) reconstructs all 216 admitted selections directly from immutable report bytes and actual process receipts using Python stdlib, without importing runner counting helpers. It checks exact header source/runtime/execution identity, schedule/header/summary selections, file hashes, each filename/mode exactly once, per-selection reconstructed counts, process exit codes, terminal summaries, report and receipt hashes. A second pass matches every raw nonpass to the maintained aggregate and inventory, including diagnostics and hashes. Result: **zero missing or duplicate files/variants, mixed provenance, summary/receipt disagreement, or inventory/aggregate outcome mismatches**. The census includes 53,876 JS files and 294 fixtures, with zero metadata or execution errors.

## Actionable inventory

The [compressed final inventory](baseline-v4/independent-mismatch-inventory.json.gz) contains exactly **9,706** nonpassing variants from 5,416 original files. Each row retains actual V4 status/reason/detail, original and variant source hashes, pinned upstream URL, original parsed `esid`, features/flags/negative metadata, report hash, primary owner and source surface. All primary-owner surfaces exist. Fresh same-directory/same-mode passing controls are verified for 5,498 rows; the remaining 4,208 explicitly have no such passing control. No historical pass or diagnostic supplies a V4 result.

| Exclusive disposition | Variants | Meaning |
| --- | ---: | --- |
| Resource/budget/timeout qualification | 4,527 | 4,488 isolated wall timeouts and 39 host budget failures; not assertion waivers |
| Explicit capability boundaries | 3,318 | Modules 1,996; shared memory 974; agents 224; blocking mode 18; IsHTMLDDA 84; GC 22 |
| Unvalidated semantic candidates | 1,640 | Owning feature must reproduce and validate before repair or defect claim |
| Harness qualification | 141 | All observed harness string-length budget failures, kept separate from guest negatives |
| Unqualified rejection policy | 74 | 50 synchronous and 24 asynchronous; conservative runner/host policy is not automatically an ECMAScript defect |
| Generator state/reentry separation | 6 | Current guest-generator state guard nonpasses; not generalized host reentry authority |
| **Total** | **9,706** | Exactly failed + unsupported |

Generated RegExp selection `14250-14499.jsonl` specifically contains **493 worker-wall-timeout** failures and **7 host-error/budgetExceeded/steps** failures. These retain resource qualification as primary and RegExp as secondary ownership; they are not 500 established semantic defects. Other host budgets comprise 25 steps, 10 string-length and four data-depth failures across the full cohort. Harness budget failures remain separately classified.

The module requirement audit independently finds all 1,153 nonmodule runtime module-feature requirements observed, plus all 729 corresponding parse-negative variants observed and passing. These parse controls do not qualify the runtime loader. Among 74 rejection-policy rows, 18 carry `Test262Error` reasons, but only six have actual `Expected ...` assertion diagnostics; twelve are blank deliberately thrown test sentinels. An initial inventory calculation used error type alone for the assertion subcount; final inventory explicitly distinguishes these metrics without changing any raw outcome or primary disposition.

Category, primary-owner and two-component path partitions each sum to 9,706. Feature attribution overlaps because a variant may declare multiple features and must not be summed as a denominator. The fixed ECMA-262 edition 16 / ECMA-402 edition 12 and explicitly pinned newer APIs remain unchanged. Fixture-to-edition reconciliation stays explicit; this full-corpus baseline is not silently presented as a published-edition-specific pass rate.

## Reproduction and preserved provenance

Execute the [independent inventory procedure](v4-independent-inventory-procedure.md) against the [V4 replay inputs](baseline-v4/replay.md). Original metadata is read from pinned corpus bytes and hashed before YAML parsing; only CRLF/CR line endings are normalized for parsing. The final inventory was rebuilt from all completed reports, not completed by filling the partial prefix with historical outcomes.

[Inventory archive receipt](baseline-v4/inventory-archive-receipt.json): raw JSON 16,419,181 bytes, SHA-256 `9b196c676c2ce180e48a4ec9677565e1b4bc3bcbd217651ec88d2807521e70ad`; deterministic gzip 865,640 bytes, SHA-256 `4a919f7e05b17c4c71f59703fd62e4a7afdef5ca02377d76f86d14adacc4bedc`. Decompression roundtrip was verified byte-for-byte. A compact independent receipt check is:

```sh
python3 - <<'PY'
import gzip, hashlib, json, pathlib
r=pathlib.Path('docs/plans/complete-conformance-runner/baseline-v4')
a=json.loads((r/'inventory-archive-receipt.json').read_text())
z=(r/a['archive']).read_bytes(); b=gzip.decompress(z)
assert hashlib.sha256(z).hexdigest()==a['archiveSha256']
assert hashlib.sha256(b).hexdigest()==a['sha256']
i=json.loads(b); c=json.loads((r/'independent-final-crosscheck.json').read_text())
assert i['manifestId']==c['manifestId'] and i['counts']==c['counts']
assert len(i['mismatches'])==i['counts']['failed']+i['counts']['unsupported']==9706
assert i['observedVariantIds']==i['enumeratedVariants']==102926
assert sum(g['count'] for g in i['groups'])==9706
assert c['accountingVerified'] and not c['runnerSuccess']
print('V4 inventory archive and independently reconciled totals verified')
PY
```

A [separate V3/V4 observation delta](baseline-v4/v3-v4-observation-delta.json) re-reads and hashes the historical admitted reports solely for comparison. It finds 189 failed→passed and 126 passed→failed identities, net 63 additional passes; all 3,318 unsupported identities remain unsupported. Source and selection scheduling differ, and resource timing can vary. These transitions are **not causal proof of repairs or regressions** and do not enter V4 accounting. The report lists 328 changed status/reason/code/budget/error-type signatures; diagnostic message text alone is not compared.

No runner source, budgets, assertions, host authority, Git index or publication settings changed during this audit. Baseline completion, local/remote delivery and successful root/scoped publication remain separate evidence claims. The separate delivery receipts establish publication; this audit establishes current corpus accounting and an actionable nonpass inventory.
