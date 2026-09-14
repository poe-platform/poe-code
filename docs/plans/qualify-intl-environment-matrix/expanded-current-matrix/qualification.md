# Expanded Intl matrix and plural-category repair

Status: **task acceptance remains open**. Qualification on 2026-09-14 UTC expands the earlier 33-test environment matrix to the selected 700-test Intl/snapshot/SDK suite. One independent semantic defect was repaired with TDD. This is not a blanket conformance or backend-support claim.

## Source and reproducibility

Baseline: local main `034185b29ade2973996b1999b538b4e80388c4b0` plus inherited dirty source, identified by [source manifest](source.json). Fetched remote main: `2976916aafe9967d14b50593a6a74894978f2cb3`. Histories diverged by 30 local / 59 remote commits. Delivery uses an isolated detached checkout of remote main, with no new branch, force-push, shared-index mutation or unrelated source carried into delivery. The two existing edited files were identical to remote main before this repair.

Target unchanged: [ECMA-262 edition 16](https://262.ecma-international.org/16.0/), [ECMA-402 edition 12](https://402.ecma-international.org/12.0/) (June 2025), Test262 `419d3e0a2273ba01a3bfcbec423f2801425b8e93`, and the existing tracked Temporal extension `e8cc03fc970a65a3359e8870e3b35e687ac94e55`. Node support remains >=18.18. Native APIs newer than that target do not silently become requirements.

[Receipt](receipt.json) retains executable paths, exact matrix argv, per-service locale availability, ICU/CLDR/Unicode/tzdata, supported calendars/numbering systems/timezones, all failed assertion names/messages, report hashes, controls and repair hashes. [Manual QA](manual-qa.md) contains executable independent controls and the complete nine-service cleanup/replay driver. Full raw test reports remain locally alongside this report. Reproducing the baseline requires the manifest-identified working source, including inherited untracked qualification tests; this commit does not deliver those earlier drafts. The independently validated delivery candidate is distinguished below.

## Baseline matrix

Every row ran with both `TZ=UTC` and `TZ=America/New_York`, `LANG=en_US.UTF-8`, `LC_ALL=C.UTF-8`; LC_TIME, NODE_ICU_DATA, ICU_DATA and NODE_OPTIONS unset. Results below are **per timezone**, before the category repair; zero skipped tests.

| Node    | ICU / CLDR / Unicode / tzdata | Passed / failed |
| ------- | ----------------------------- | --------------- |
| 18.18.0 | 73.2 / 43.1 / 15.0 / 2023c    | 681 / 19        |
| 18.20.8 | 74.2 / 44.1 / 15.1 / 2024a    | 681 / 19        |
| 20.20.2 | 78.2 / 48.0 / 17.0 / 2025c    | 692 / 8         |
| 22.23.2 | 78.2 / 48.0 / 17.0 / 2026a    | 700 / 0         |
| 24.21.0 | 78.3 / 48.0 / 17.0 / 2026c    | 697 / 3         |
| 26.8.2  | 78.3 / 48.0 / 17.0 / 2026c    | 688 / 12        |

```sh
node node_modules/vitest/vitest.mjs run packages/safe-js/src/interp/globals/intl packages/safe-js/src/interp/intl- packages/safe-js/src/snapshot/intl-bound-call-context.test.ts packages/safe-js/src/interp/structured-clone-intl.test.ts packages/safe-js/src/interp/structured-clone-sdk-intl.test.ts --reporter=json --outputFile=/tmp/intl-tests.json
```

Coverage includes aliases, unsupported-locale fallback, coercion/order, numbering overrides, Gregorian/Japanese era boundaries, explicit UTC/New York/Kathmandu/+05:45 inputs, both 2024 DST transitions, collation, segmentation, plural/number/duration/list/relative-time formatting, populated ISO fields, parts/ranges and invalid inputs. Backend absence is recorded explicitly; native DurationFormat is absent before Node24, while the guest duration implementation is exercised.

Nine-service pending/completed cleanup and two restores per checkpoint pass all 72 evaluations across twelve cells. Saved options, getter counts, cached date/number/compare identities, stable outputs and absent process/require/fetch authority are checked. Node18/20/22 receipts precede the ordering edit; Node24/26 receipts follow it. Dedicated post-repair replay tests below check the changed field independently. No cross-version or cross-ICU snapshot migration is claimed.

## Repaired required invariant: INTL-ENV-PLURAL-ORDER

[402 17.3.2 step 4](https://402.ecma-international.org/12.0/#sec-intl.pluralrules.prototype.resolvedoptions) requires the order zero, one, two, few, many, other. The portable backend and older native engines returned alphabetical ordering, masking the error in native-differential tests. French returned many/one/other; Arabic and English ordinal expose further reordered members.

Five new independent tests failed before the runtime edit ([red](plural-order-red.log)). The repair sorts the captured category list in specification order without changing category membership, locale selection, numeric behavior, budgets or authority. The differential oracle normalizes only this mandated ordering; the independent tests assert exact Arabic/French/English ordinal arrays and fresh arrays across pending/completed cleanup and two restores.

Post-repair: **5/5 tests pass in every one of the twelve cells** (60 test executions, zero skipped). Node22 focused PluralRules suite: **42/42**, zero skipped. [Green](plural-order-green.log). This repair does not assert compatibility with snapshots containing an old invalid order; snapshot validation remains strict.

## Narrow dispositions of remaining findings

- **INTL-ENV-OFFSET remains a required support failure:** valid +05:45 is rejected on Node18/20. UTC/New York/Kathmandu numeric neighbors pass. No timezone substitution or support-floor increase is accepted.
- **INTL-ENV-ALIAS-YES remains unresolved:** all twelve independent controls remove nonboolean ka/kf/kr/ks/kv yes values incorrectly; boolean-key neighbors pass. Native agreement does not override the pinned Unicode canonicalization contract. Existing locale-list/Locale/replay surface findings remain owned by this task.
- **INTL-ENV-REVERSED-TEMPORAL is newly narrowed:** Node18 throws RangeError for PlainTime 13→12, while 12→13 returns correctly sourced hour fields. Node20+ pass both. The tracked Temporal path delegates to an older native range implementation. This is not punctuation variation; no operand swap is accepted as a repair.
- **INTL-ENV-OLD-ORACLES:** of the 19 Node18 failures, 17 concern native expectations (six NumberFormat cases including private-data measurement, nine PluralRules cases, one unavailable Iterator reference, one unit inventory comparison); the other two are offset and reversed range. Node20 has six PluralRules native comparisons and the Iterator oracle failure in addition to offset. Independent exact-decimal, range-source, NaN coercion-order, floor-rounding and trailing-zero controls pass in all twelve cells. Older native missing APIs/fields are not evidence that the guest must lose target-edition behavior. These test failures remain reported, not skipped or relabeled as passing.
- **INTL-ENV-ISO-SPACING:** two Node24/26 recovery comparisons differ solely in range separator U+2009 versus U+0020 around the en dash. Russian February/March and Arabic February values and source fields remain populated and correct. The test compares ISO output to Gregorian wording, although locale/calendar patterns may differ. [Detailed Node24 diff](node24-failure-details.log) reproduced 39 passes / three failures; the third is the repaired plural-order defect. Required month-field assertions are not relaxed.
- **INTL-ENV-NEWER-NATIVE:** Node26 removes seven legacy Intl.Locale getters that the test oracle reads; the guest uses methods. Its three PluralRules resolvedOptions comparisons also encounter native `notation`, absent from edition-12 Table 30 (French additionally exposed ordering). [Native controls](node26-newer-native.json) record the exact fields. Do not add newer notation behavior merely to match Node26 or accept undefined locale fields as correct.
- **INTL-ENV-UPSTREAM-COST remains open:** fresh pinned three-file selection completes with two passed / four timed out / zero unsupported at unchanged 3000ms per variant and 10000ms startup limits. Constructor option ordering passes; both modes of unicode-ext-canonicalize-yes-to-true.js and Segmenter containing/iswordlike.js time out. [Raw pinned receipt](pinned.jsonl) retains hashes and terminal status. No timeout, budget or assertion was weakened.
- Bun/Workerd/custom ICU and cross-environment migration were not rerun in this increment. Earlier receipts do not establish current delivery-candidate coverage. These gaps and the unresolved semantic/support findings prevent task acceptance.

## Delivery candidate checks

Remote-based candidate contains only three owned source/test files and this evidence. `npm ci` succeeded. `npm run build:workspaces -- --workspace=@poe-code/safe-js` succeeded, including eight built-import checks. Changed-file ESLint passed. After building, the exact selected Intl/snapshot/SDK command above passed **672/672, zero skipped** on Node22.23.2/ICU78.2. This differs from the dirty baseline's 700 because inherited untracked tests/repairs are excluded; the new five regressions are included. An initial test launch before generated Intl data existed failed suite loading (44 tests ran; 30 suites could not load), exit 1; the post-build rerun is the passing result. No full-package/full-repository pass or CLI visual change is claimed.

Preservation checks confirm all pre-existing SafeJS files outside the two owned edits and the original staged diff are unchanged. No explicitly associated issue was supplied, and none is closed.

Local commit: pending. Remote-main ancestry: pending. Required root/scoped workflow publication: pending. No new npm version is claimed here. Final receipts will identify these independently. Recovery if publication is incomplete: inspect the failing job, reproduce the concrete failure, repair with a separate tested commit, and follow a verified descendant through all three scoped package publications and poe-code; never publish locally or destructively roll back.
