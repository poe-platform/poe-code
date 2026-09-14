# Built-in reconciliation and BigInt construction repair

Overall `qualify-builtins` acceptance remains open. This increment repairs QB-BIGINT-CONSTRUCT and retains every other named unresolved category/variant blocker from [the preceding audit](../reconciliation-20260913/qualification.md). It does not certify all built-ins on the changed runtime.

## Target and source

The target remains ECMA-262 edition 16 and ECMA-402 edition 12 (June 2025), Test262 `419d3e0a2273ba01a3bfcbec423f2801425b8e93`, with the existing separately pinned newer APIs. BigInt construction is an edition requirement: §21.2.1 permits class heritage, while §21.2.1.1 rejects a defined NewTarget before coercion. §21.2.2.3 requires the prototype property to be non-writable. The [previous specification receipt](../reconciliation-20260913/specification-receipt.json) remains the recorded primary document; another browser fetch exceeded its provider size limit.

Base HEAD is `e07a8fd3a0db21495cc0b14c6d7321fa0df4610e`, with inherited working changes. Node 22.23.2, ICU 78.2, Darwin arm64. [Initial source inventory](source-before.json) records source bytes and the staged diff fingerprint. The 1,798 files from the preceding built-in inventory exactly matched at task start. Remote-main read-only observation was `dea009de8f6c7ff608f295c6986d56f255570939`; that revision was not executed.

## Category evidence reconciliation

`python3 docs/plans/qualify-builtins/bigint-construct-20260913/reconcile.py` independently verifies all 216 raw historical terminal report hashes, provenance headers, selected variants, 53,876 pinned fixture hashes and harness hashes. [Reconciliation](reconciliation.json) reproduces 93,220 passes / 6,388 failures / 3,318 unsupported variants and actual results for all 108 built-in/Intl/Annex B ledger rows. Historical source remains `a4476e3fabf1bf5f3c492aa76f38ff0bf3d05e46`, closure `aa87050d0107c7e5c7ab7beab09ff260c65c7b119fc25d76ac294e9c6565f5b3`. Parent categories overlap: do not sum them or interpret them as edition-specific percentages.

[Focused evidence verification](focused-reuse.json) rehashes all 255 linked artifacts across the prior owners, with zero missing/changed artifacts. Artifact integrity is not acceptance. Object/Reflect/Proxy/descriptor, binary/species, Promise/disposal, iterator, Intl and regex owner results retain their actual revisions and blockers. The initial source match permits reuse of prior observations at task start; the BigInt runtime change means those receipts do not prove whole-closure equality afterward. No unrelated complete suite was repeated.

The [6,777 individually indexed historical nonpasses](../reconciliation-20260913/unresolved-variants.json.gz) remain addressable by fixture and mode. This increment supersedes QB-BIGINT-CONSTRUCT only. QB-ARRAY-BOX, QB-ARRAY-ORDER, QB-ARGUMENTS-ITERATOR, QB-DATE-PRECISION, QB-SYMBOL-REALM, QB-THROWTYPEERROR-REALM and QB-CALLER retain their preceding concrete observations and unresolved dispositions. QB-MATCH-EDITION remains a newer-fixture/edition mismatch, not a repair request. QB-REVISION, QB-EDITION, QB-REVALIDATE and QB-MATRIX remain blockers; missing explicit host capabilities are not reclassified as ECMAScript defects. The regex indices deadlines, RGI budgets and minimum-backend Unicode limitations remain named nonpasses.

## TDD repair and controls

`bigint-constructor.test.ts` first failed two heritage/construction cases with “Class extends value is not a constructor or null”; the call coercion/receiver-brand/native-prototype control passed. [Red log](red.log). The repair adds a construction hook that immediately throws TypeError, matching the existing Symbol mechanism. BigInt remains callable; it can be used as class heritage and as Reflect.construct's newTarget. Direct, derived and reflected construction reject before any Proxy getter on the supplied argument runs.

The first completed BigInt corpus exposed a descriptor regression introduced by that hook: the materialized constructor prototype became writable. Its actual count is **77 files / 154 variants: 152 passed, two failed**, not 142 passes as briefly misstated in chat. [Raw report](final-corpus.jsonl). A new descriptor regression then failed independently ([red log](descriptor-red.log)); setting `writable: false` explicitly fixes it within the same atomic repair. No assertion, budget, timeout or supported runtime was relaxed.

Controls cover exact class/prototype identity, newTarget, direct/derived/reflected rejection before coercion, successful number-hint coercion, invalid receiver brands, native host prototype isolation, and pending/completed JSON checkpoint replay. This internal runtime repair adds no CLI or SDK option and has no visual CLI change.

## Reproducible commands and attempts

From the repository root:

```sh
npx vitest run packages/safe-js/src/interp/globals/bigint-constructor.test.ts packages/safe-js/src/interp/bigint.test.ts packages/safe-js/test/integration/exotic-symbol-constructor.test.ts
npx eslint packages/safe-js/src/interp/globals/bigint.ts packages/safe-js/src/interp/globals/bigint-constructor.test.ts
node --import tsx packages/safe-js/test/conformance/command.ts --corpus /tmp/safejs-regexp-test262-419d3e0 --include built-ins/BigInt/ --report <new-report-path.jsonl>
python3 docs/plans/qualify-builtins/bigint-construct-20260913/reconcile.py
```

The corpus runner requires a fresh report path. Defaults remain the maintained 3,000 ms per-variant deadline and existing budget defaults. `corpus.jsonl` is an excluded aborted enumeration (source changed while adding replay coverage), exit 1. `final-corpus.jsonl` is the completed intermediate descriptor-failure run, exit 1. Neither is counted as a final pass. The initial inline reconciliation attempt raised KeyError on fixture records without results; the preserved utility correctly handles fixture records with the maintained optional-results representation, and its verified accounting passed.

Final source, terminal counts, report SHA-256 and preservation are recorded in `qualified-receipt.json`. Focused test and lint output are retained in `qualified-tests.log` and `qualified-lint.log`. No full-package, minimum-runtime, Workerd, installed-artifact, screenshot or release gate is inferred from these focused checks.

## Delivery boundary

The atomic local commit is separate from remote-main delivery and publication. This increment has no push or release receipt; inherited dirty repairs and historical releases are not claimed as delivery of this repair. Overall qualification remains open for the named category/revision/edition/runtime blockers above.
