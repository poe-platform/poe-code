# Intl formatter replay and matrix receipt

**Acceptance remains open.** Evidence-only audit on 2026-09-13. No runtime or maintained test was changed, and no earlier uncommitted repair is claimed as this increment’s work.

## Source and target

Source base on `main`: `fcd686882afb26cd462f46c98be6f99289e0c9fa`, plus inherited local changes. The base SHA alone does not identify the tested working tree. SHA-256 of the sorted compact JSON mapping of 1,836 SafeJS file paths to content hashes (excluding dist/node_modules): `8f508aec2f379f33c535f453012772aac6b2f46212cf59770d340cb7b26e8303`. Original staged-diff SHA-256: `839e9e04f0f5e07fae2138a1c64a573e924875d6ccbb339c87774d51eaf251a8`.

Target remains [ECMA-262 edition 16](https://262.ecma-international.org/16.0/) and [ECMA-402 edition 12](https://402.ecma-international.org/12.0/) (June 2025), Test262 `419d3e0a2273ba01a3bfcbec423f2801425b8e93`, and the previously tracked Temporal extension `e8cc03fc970a65a3359e8870e3b35e687ac94e55`. DurationFormat belongs to the published target. Node support remains `>=18.18`.

| Tested file under packages/safe-js                             | SHA-256                                                            |
| -------------------------------------------------------------- | ------------------------------------------------------------------ |
| `src/interp/intl-locale.ts`                                    | `8e4390abe43554e2116988c2d987fcef238d54143f5e70d2c97956eb6098566b` |
| `src/interp/intl-options.ts`                                   | `39bdcf37e560ba5f41d412779d75adfe8afa6fc32d3e1a8934b341ffdb561581` |
| `src/interp/intl-datetimeformat.ts`                            | `b588e94daa9dd8b23fe80618fcaf6f8bff41ec751fd3016f21adaa5fe0c16b0f` |
| `src/interp/intl-segmenter.ts`                                 | `d66349e26a498fb86dd50e47a0e6dadd6b0131cdcacb03dacefd48ef381805de` |
| `src/snapshot/guest-heap-validation.ts`                        | `bf38af7b82216c662f4b9ca4d9f8348b801870e4d06196ac57d5984bb3f986b8` |
| `src/interp/globals/intl-environment-invariants.test.ts`       | `5ee2900a786686fa1e43fc3ff92d68ceaba93e711a8e1c863458ee7d94954bdd` |
| `src/interp/globals/intl-segment-boundary-portability.test.ts` | `3335d277b9305d449b63a295e5500596396867bf7722d96a3c2de3448acd528d` |

## Executed matrix

Each row ran under both `TZ=UTC` and `TZ=America/New_York`, with the selected Node binary’s directory first in PATH. `LANG=en_US.UTF-8`, `LC_ALL=C.UTF-8`; LC_TIME, NODE_ICU_DATA, ICU_DATA and NODE_OPTIONS were unset. Full locale-data profiles were observed; custom/small-ICU was not qualified.

| Node    | ICU / CLDR / Unicode / tzdata | Environment assertions per TZ | Nine-service replay per TZ | Native DurationFormat |
| ------- | ----------------------------- | ----------------------------- | -------------------------- | --------------------- |
| 18.18.0 | 73.2 / 43.1 / 15.0 / 2023c    | 32 passed, 1 failed           | 6/6 evaluations passed     | absent                |
| 18.20.8 | 74.2 / 44.1 / 15.1 / 2024a    | 32 passed, 1 failed           | 6/6 evaluations passed     | absent                |
| 20.20.2 | 78.2 / 48.0 / 17.0 / 2025c    | 32 passed, 1 failed           | 6/6 evaluations passed     | absent                |
| 22.23.2 | 78.2 / 48.0 / 17.0 / 2026a    | 33 passed, 0 failed           | 6/6 evaluations passed     | absent                |
| 24.21.0 | 78.3 / 48.0 / 17.0 / 2026c    | 33 passed, 0 failed           | 6/6 evaluations passed     | present               |
| 26.8.2  | 78.3 / 48.0 / 17.0 / 2026c    | 33 passed, 0 failed           | 6/6 evaluations passed     | present               |

All matrix tests have zero skips. The single failure on each Node18/20 cell is `qualifies 2024 spring/fall transition inputs in +05:45`: constructor RangeError for a valid fixed-offset zone. UTC, America/New_York and Asia/Kathmandu controls pass, including both 2024 DST transitions. No runtime, timeout, budget or assertion was weakened.

All available native services accept en-US, pl-PL, ru-RU, ar-EG, ja-JP, de-DE and fr-FR and reject zz-ZZ in supportedLocalesOf. Default date options use gregory/latn and the selected process TZ. Native DurationFormat absence is distinct from guest backend support: guest duration checks pass in every cell. Full supported calendar/numbering-system/time-zone lists and per-service availability remain in the local environment receipts.

The 33 assertions cover canonical aliases/deduplication and live locale properties; abrupt option conversion; lookup fallback; populated ISO month/range fields in five locales; numeric zone/DST results; Japanese era and Gregorian BCE/CE/leap boundaries; numbering overrides; collation equivalence/antisymmetry; lossless segmentation and UTF-16 positions; plurals, exact decimals and rounding; number/duration/list/relative-time parts; display names; invalid inputs; cached requested options and formatter replay.

Required numeric/structural properties are checked independently of native output. English strings, plural assignments, era names and zone histories are recorded data-profile controls, not universal mandated wording. Same-output replay alone would not establish correctness; the independent field assertions remain necessary.

Selected Intl/snapshot/structured-clone integration on Node22.23.2/ICU78.2: **700 passed, zero failed/skipped**, exit 0. This overlaps matrix coverage and is not an additional set of 700 distinct semantic invariants.

## Manual reproduction

1. Verify the source hashes above before claiming an identical candidate. Existing untracked tests and dirty runtime changes are not delivered by this evidence commit.
2. Select each recorded executable below and set its directory first in PATH. Run both TZ inputs, leaving all budgets and deadlines unchanged.
3. Record process.versions, the locale/ICU environment, DateTimeFormat.resolvedOptions(), supportedLocalesOf for the eight locales above on all nine services, and Intl.supportedValuesOf for calendar, numberingSystem and timeZone. Absent native services must be recorded as absent, not skipped passes.
4. Execute the two maintained environment test files and the broader integration command. Inspect every assertion failure, rather than treating a JSON-writing process exit as semantic success.
5. Execute the replay driver below as ESM from the repository root using `node --import tsx --input-type=module` with the block on stdin. Node18.18.0 requires `--loader tsx` instead of `--import tsx`. The host grants no guest modules or bindings. The Markdown steps are the QA procedure; no standalone QA program is added to the repository.

Recorded executables:

- `/Users/kjopek/.npm/_npx/5c21e3f970cab345/node_modules/node/bin/node`
- `/Users/kjopek/.npm/_npx/00073ba5d7c1f8bc/node_modules/node/bin/node`
- `/Users/kjopek/.npm/_npx/185e25162edaacfb/node_modules/node/bin/node`
- `/Users/kjopek/.nvm/versions/node/v22.23.2/bin/node`
- `/Users/kjopek/.npm/_npx/538786c08bcb9442/node_modules/node/bin/node`
- `/Users/kjopek/.npm/_npx/131005c554cfb1ac/node_modules/node/bin/node`

```sh
node node_modules/vitest/vitest.mjs run packages/safe-js/src/interp/globals/intl-environment-invariants.test.ts packages/safe-js/src/interp/globals/intl-segment-boundary-portability.test.ts --reporter=json --outputFile=/tmp/intl-environment-tests.json

node node_modules/vitest/vitest.mjs run packages/safe-js/src/interp/globals/intl packages/safe-js/src/interp/intl- packages/safe-js/src/snapshot/intl-bound-call-context.test.ts packages/safe-js/src/interp/structured-clone-intl.test.ts packages/safe-js/src/interp/structured-clone-sdk-intl.test.ts --reporter=json --outputFile=/tmp/intl-integration.json
```

## Additional replay control

All nine service constructors are initialized with an observable localeMatcher getter. That getter is replaced with a throwing getter after construction. Output and resolved options must remain stable; construction reads exactly nine getters and subsequent calls do not reread them. Collator.compare, DateTimeFormat.format and NumberFormat.format preserve cached identity. Pending and completed snapshots are each restored twice: **72/72 evaluations across twelve cells pass**. Each evaluation independently checks execution, stable output, saved options, getter counts, cached identity, absent ambient authority and meaningful sample fields. This is same-environment replay, not a claim of cross-ICU snapshot portability.

```js
import { run } from "./packages/safe-js/src/run.ts";
import { dump } from "./packages/safe-js/src/dump.ts";
const source = `
const specs=[['Collator',{}],['DateTimeFormat',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}],['NumberFormat',{numberingSystem:'latn',useGrouping:false}],['PluralRules',{}],['Segmenter',{granularity:'word'}],['ListFormat',{style:'long'}],['RelativeTimeFormat',{numeric:'always'}],['DisplayNames',{type:'region'}],['DurationFormat',{style:'long'}]];
let reads=0;
const values=specs.map(([name,base])=>{const options={...base,get localeMatcher(){reads++;return 'lookup'}};const value=new Intl[name]('en',options);Object.defineProperty(options,'localeMatcher',{get(){throw 'options reread'}});return value});
const [c,d,n,p,s,l,r,v,u]=values;
const compare=c.compare,date=d.format,number=n.format;
const sample=()=>[compare('2','3'),date(Date.UTC(2024,2,10,7)),number(123),p.select(1),[...s.segment('Hello world!')].map(x=>[x.segment,x.index,x.isWordLike]),l.format(['Alice','Bob']),r.format(2,'day'),v.of('US'),u.format({hours:1,minutes:2})];
const before=sample(),options=values.map(x=>x.resolvedOptions()),count=reads;
await 0;
return {before,after:sample(),sameOptions:JSON.stringify(options)===JSON.stringify(values.map(x=>x.resolvedOptions())),sameReads:reads===count,reads,cached:[compare===c.compare,date===d.format,number===n.format],authority:[typeof process,typeof require,typeof fetch]};`;
const rows = [];
for (const mode of ["pending", "completed"]) {
  const promise = run(source);
  const settled = promise.catch((e) => ({ error: String(e) }));
  if (mode === "completed") await settled;
  const snapshot = JSON.parse(await dump(promise));
  const results = [await settled, await run(source, { snapshot }), await run(source, { snapshot })];
  const checks = results.map((result) => {
    const x = result.returnValue;
    return {
      execution: result.ok === true,
      stable: JSON.stringify(x?.before) === JSON.stringify(x?.after),
      options: x?.sameOptions === true,
      reads: x?.sameReads === true && x?.reads === 9,
      cached: x?.cached.every(Boolean) === true,
      authority:
        JSON.stringify(x?.authority) === JSON.stringify(["undefined", "undefined", "undefined"]),
      fields:
        x?.after[0] < 0 &&
        x?.after[2] === "123" &&
        x?.after[3] === "one" &&
        x?.after[4].map((p) => p[0]).join("") === "Hello world!" &&
        x?.after.slice(5).every((v) => typeof v === "string" && v.length > 0)
    };
  });
  rows.push({ mode, results, checks });
}
console.log(
  JSON.stringify(
    {
      versions: process.versions,
      TZ: process.env.TZ,
      source,
      rows,
      pass: rows.every((x) => x.checks.every((c) => Object.values(c).every(Boolean)))
    },
    null,
    2
  )
);
```

## Dispositions

- **INTL-ENV-OFFSET: unresolved required backend support.** The published CreateDateTimeFormat offset path accepts +05:45. Node18/20 native rejection still reaches the guest; this is not missing host permission or permitted punctuation variation. No timezone substitution or support-floor change is accepted.
- **INTL-ENV-ALIAS-YES: unresolved canonicalization semantics.** Fresh Node22.23.2/ICU78.2 public SDK execution returns `en-u-ka`, `en-u-kf`, `en-u-kr`, `en-u-ks`, `en-u-kv` for the corresponding `-yes` inputs; all five should retain `yes` under the previously reconciled CLDR48 profile. Boolean kb/kc/kh/kk/kn neighbors correctly remove their yes alias. The source inspection confirms native canonicalization is shared by locale-list handling and Locale creation/storage; a getCanonicalLocales-only adjustment would leave other surfaces inconsistent. No speculative partial repair was made.
- The alias disposition follows [402 §6.2.2](https://402.ecma-international.org/12.0/#sec-canonicalizeunicodelocaleid), [UTS35 revision 76](https://www.unicode.org/reports/tr35/tr35-76/tr35.html#Processing_LocaleIds) and the prior key-specific CLDR48 audit. It does not treat native agreement as proof. Minimal reproduction: `await run("return ['ka','kf','kr','ks','kv','kb','kc','kh','kk','kn'].map(k=>Intl.getCanonicalLocales('en-u-'+k+'-yes')[0])")`, using the public source import shown above.
- **INTL-ENV-ISO:** existing recovery continues passing independent nonempty month/range assertions; no new repair was needed. Matching a native empty month would fail these controls.
- Bun/Workerd observations from earlier reports are historical. They were not rerun here; custom/small-ICU, cross-environment snapshot migration and exhaustive backend/upstream coverage remain unqualified. No unavailable host capability is relabeled an ECMAScript defect.

## Pinned upstream result

Fresh Node22.23.2/ICU78.2 selection completed with **2 passed / 4 failed / zero unsupported**, exit 1, three files/six variants. DateTimeFormat constructor option ordering passed both modes. Both modes of each other fixture below failed with `worker-wall-timeout` under the unchanged **3000 ms** per-variant limit; startup limit remains 10000 ms. These are unresolved cost/execution failures, not permitted locale-data variation. Minimized passing controls do not clear them. Completion: `2026-09-14T02:45:23.442Z`; report SHA-256 `aae73604347d5f04a26f36de29c72080278b1d87c2c432118c555d099838eba3`.

```sh
node --import tsx packages/safe-js/test/conformance/command.ts --corpus /tmp/safejs-regexp-test262-419d3e0 --include intl402/Intl/getCanonicalLocales/unicode-ext-canonicalize-yes-to-true.js --include intl402/Segmenter/prototype/segment/containing/iswordlike.js --include intl402/DateTimeFormat/constructor-options-order.js --report /tmp/intl-pinned.jsonl
```

- `intl402/DateTimeFormat/constructor-options-order.js`: SHA-256 `37cc220f829f5b78bce27e5bbf2b1c7086a445a2ebbd03e98d383f8306609366`.
- `intl402/Intl/getCanonicalLocales/unicode-ext-canonicalize-yes-to-true.js`: SHA-256 `1eb41a2cd01b1a3779c65d946ab2f6efe352abafa4331e585e8c80a07bfbc696`.
- `intl402/Segmenter/prototype/segment/containing/iswordlike.js`: SHA-256 `1428d7e8d167cd338ed6f393641f71123d577252272a636813ad4f488007eac0`.

## Manual checks and delivery

Only this report and a task-owned ledger addition are intended for this commit. Runtime/config/test bytes remain unchanged. Required evidence checks are report-to-result reconciliation, source and staged-change preservation, Markdown format checks on the owned text, and staged path/whitespace review. Build, full package tests, repository-wide lint and visual CLI screenshots are not claimed for this documentation-only increment. Earlier interrupted broad tests remain incomplete.

Local evidence commit: identified by this report’s Git history and the final task response. **Verified remote-main delivery: not performed. Successful release/publication: not performed; no task release receipt exists.** No push was requested. Earlier unrelated publication receipts do not deliver this candidate or close its acceptance blockers.

Raw local observations are retained under `docs/plans/qualify-intl-environment-matrix/replay-completion-audit/` (commands, source manifest, per-cell environments/tests/replay, alias and integration results). Generated artifacts are not staged. The essential results and executable replay recipe are contained in this report.
