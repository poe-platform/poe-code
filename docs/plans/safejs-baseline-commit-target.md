# Commit-time target and publication receipt

Observed 2026-09-12 01:22–01:25 UTC. Source `git rev-parse HEAD`: `d126d355c150a076e6c5d5f110162289c57ed1c9`, branch main. Host Node 22.23.2, V8 12.4.254.21-node.56, ICU 78.2, CLDR 48.0, Unicode 17.0, tz 2026a. This read-only audit made no source repair, commit, push or publication. It supplements the [canonical ledger](safejs-gap-closure-evidence.md).

## Immutable compatibility target

The target stays [ECMA-262 edition 16, June 2025](https://262.ecma-international.org/16.0/) plus [ECMA-402 edition 12, June 2025](https://402.ecma-international.org/12.0/), and Test262 `419d3e0a2273ba01a3bfcbec423f2801425b8e93`. The corpus pin is present in `packages/safe-js/test/conformance/corpus.ts:10`. Newer Temporal, weak upsert and Atomics proposals remain separately pinned supplements in the ledger, not grounds to silently change this edition. Older weak collections and Atomics already belonging to the edition remain in its core scope.

Fresh HTTP 200 official-source reads using Python `urllib.request.urlopen(url).read()` and `hashlib.sha256(bytes).hexdigest()` yielded:

| Source                                                                                       | SHA-256                                                            |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| ECMA-262 edition 16 HTML                                                                     | `6a28f9423133ed7b7c59a40baf620c2740f12f0bc9c251042f2a85b9cc5ed713` |
| ECMA-402 edition 12 HTML                                                                     | `6d88587f7ee3759a604f59e0af4390c8f103d8ac4be124d8e10feb3ec48121b0` |
| [Node release index](https://nodejs.org/dist/index.json)                                     | `3f05af6e148930e21583afa95634be0336df1e2aeaec1a72f6f682eec3cb1759` |
| [Node release schedule](https://raw.githubusercontent.com/nodejs/Release/main/schedule.json) | `1cf0432ceb9dfde7f1fd4cce43206519942cfdfad5a26039c2f4bb20fde8549c` |

The browser tool rejected the large 262 page; the direct official HTTP read succeeded. The other official pages were also browsed. Node 22/24/26 are the supported Node release lines at this timestamp; Node 18/20 are upstream EOL but still admitted by this package and remain required checks. Neither an upstream EOL nor safe-bash's stricter engine narrows SafeJS support.

## Actual runtime contract and bounded artifact reproduction

`npm view @poe-platform/safe-js version engines dist.shasum gitHead --json` reports engines `>=18.18`; `scripts/package-safe.mjs` uses bundle target `node18.18` and generated engine default `>=18.18`. Both safe and root release workflows use Node major 22. Local README explicitly advertises Node 18.18+; its conformance and host-boundary caveats agree with current source inspection. The published workspace name is `@poe-platform/safe-js`; the private workspace `@poe-code/safe-js@0.0.1` is not a public version receipt.

Fresh probe runs used the already installed **0.1.559** artifact, not the new latest 0.1.560 or the older local source. Its actual entrypoint is `/tmp/safejs-published-baseline.gM67xh/node_modules/@poe-platform/safe-js/dist/safe-js/index.js`, SHA-256 `9a505a17047f5d6f17785ae090385082421a592b792f7311e102ec4c49c514ed`. The manifest still reports 0.1.559. No fresh artifact installation was performed. Re-run by installing this exact package into a disposable consumer, placing the following probe there as `gaps.mjs`, and invoking each pinned runtime with that file. These are manual probes, not shipped tests.

```javascript
import { run } from "@poe-platform/safe-js";
console.log(JSON.stringify({ runtime: process.versions.node, icu: process.versions.icu }));
for (const locale of ["en-US", "pl-PL", "ru-RU"]) {
  const source = `const o={calendar:'iso8601',month:'long',timeZone:'UTC'}; const f=new Intl.DateTimeFormat(${JSON.stringify(locale)},o); return [f.formatToParts(Date.UTC(2000,1,29)),new Temporal.PlainMonthDay(2,29).toLocaleString(${JSON.stringify(locale)},o),new Temporal.PlainYearMonth(2000,2).toLocaleString(${JSON.stringify(locale)},o),f.formatRangeToParts(Date.UTC(2000,1,29),Date.UTC(2000,2,2))];`;
  try {
    const r = await run(source);
    console.log(
      JSON.stringify({
        id: "iso-" + locale,
        ok: r.ok,
        value: r.returnValue,
        error: r.error ? String(r.error) : undefined
      })
    );
  } catch (e) {
    console.log(JSON.stringify({ id: "iso-" + locale, error: String(e) }));
  }
  const f = new Intl.DateTimeFormat(locale, {
    calendar: "iso8601",
    month: "long",
    timeZone: "UTC"
  });
  console.log(
    JSON.stringify({
      id: "native-" + locale,
      value: [
        f.formatToParts(Date.UTC(2000, 1, 29)),
        f.formatRangeToParts(Date.UTC(2000, 1, 29), Date.UTC(2000, 2, 2))
      ]
    })
  );
}
const value = Promise.resolve(1);
Object.defineProperty(value, Symbol("label"), { value: 42, enumerable: true });
Object.defineProperty(value, "label", { value: "answer", enumerable: true });
const r = await run("return [p.label,Object.getOwnPropertySymbols(p).length];", {
  bindings: { p: value }
});
console.log(JSON.stringify({ id: "native-promise-import", ok: r.ok, value: r.returnValue }));
```

Executed command shape: `<exact-runtime> /tmp/safejs-published-baseline.gM67xh/gaps.mjs`. Probe file SHA-256: `5fe788c26f075a38ae82db955b39dafa7c621ca705b4d40ec4dfb36cd19eb479`. All seven commands exited 0 with empty stderr: this means the recorder completed, not that the requested assertions passed. All en-US/pl-PL/ru-RU cases were executed.

| Required cell | Actual runtime / ICU                   | Selected en-US ISO output                 | Native Promise result |
| ------------- | -------------------------------------- | ----------------------------------------- | --------------------- |
| MIN           | Node 18.18.0 / 73.2                    | February parts/name populated             | `["answer",0]`        |
| N18           | Node 18.20.8 / 74.2                    | populated                                 | same                  |
| N20           | Node 20.20.2 / 78.2                    | `[[],"","",[]]`                           | same                  |
| CI22          | Node 22.23.2 / 78.2                    | `[[],"","",[]]`                           | same                  |
| N24           | Node 24.21.0 / 78.3                    | populated                                 | same                  |
| N26           | Node 26.8.2 / 78.3                     | populated                                 | same                  |
| BUN           | Bun 1.3.11 / 74.2                      | populated                                 | same                  |
| WORKERD       | required 2026-09-01 compatibility date | not executed: `command -v workerd` exit 1 | unverified            |

Bun's `process.versions.node` reports compatibility version 24.3.0; `bun --version` reports the actual runtime 1.3.11. These cells are representative qualification obligations, not a claim that every engine-admitted patch/platform is covered.

ISO owner `repair-iso-month-formatting`: native Intl also returned `[[],[]]` on N20/CI22; native agreement is not proof of meaningful ISO output. Classify as reproduced runtime/backend limitation requiring the Intl dependency audit, with adapters still responsible for documented behavior. Other cells had populated selected month results; this is not a universal runtime failure. Promise owner `repair-promise-symbol-admission`: expected requested admission `["answer",1]`, actual `["answer",0]` everywhere. Source `native-promise-properties.ts` enumerates `Object.getOwnPropertyNames` and data descriptors only; `values.ts` uses that helper for native imports. README documents omitted symbols and accessor authority. This is an unresolved requested host-admission capability/intentional current boundary, not by itself an ECMA-262 violation. Retired/live realm isolation, pending and completed replay, host getters, negative authority controls and maintained regression before repair remain required owner checks; this repeat did not rerun them. New latest artifact behavior is unverified.

## Current release receipts, separated from this task

Fresh `git ls-remote origin refs/heads/main` returned `16fd655592118dbac4cf6764b8a2f3c8f6138786`. This differs from local source and earlier receipts at `79999cba7bb7bae0581a7a1ba035c4abed6f0397`.

For each package the command was `npm view <package> version engines dist.shasum gitHead --json` (exit 0, empty stderr):

| Package                 | Latest  | Engine  | Tarball SHA-1                              |
| ----------------------- | ------- | ------- | ------------------------------------------ |
| @poe-platform/safe-js   | 0.1.560 | >=18.18 | `279bb7ca56911a3ba4e4ac733da48cab085bd76f` |
| @poe-platform/safe-fs   | 0.1.560 | >=18.18 | `94a25a32ebb215d1ce1e0ccba7b00b35494e6826` |
| @poe-platform/safe-bash | 0.1.560 | >=22    | `628c61477bf0df03f99f4feaef9d44bb0bc2e316` |
| poe-code                | 15.0.24 | >=18.18 | `722194ab3adc8a6c98059e76c623c135aef3fc8a` |

`gh run view 34663522111 --repo poe-platform/poe-code --json headSha,status,conclusion,url,jobs` returned completed/success at remote `16fd655...`; publish completed 2026-09-12T01:06:07Z. Build, focused package tests, package lint, installed tarball Node/Bun/type/browser probes and three publish steps succeeded in [scoped release 34663522111](https://github.com/poe-platform/poe-code/actions/runs/34663522111). These workflow gates are not a complete Test262 qualification.

Freshly decoded [safe-js 0.1.560 registry provenance](https://registry.npmjs.org/-/npm/v1/attestations/@poe-platform%2fsafe-js@0.1.560) identifies source `16fd655592118dbac4cf6764b8a2f3c8f6138786`, `.github/workflows/release-safe.yml`, and invocation 34663522111/attempts/1; subject SHA-512 hex `67e77b19beae34230da9e9767bfe62ad6619c1c4c892f1fe906c357fc0a84f1ff89cc5e52843566a0d391f78c16f0280a4d4b000265e9507499882fb84f42a46`. Signatures were not independently verified. The scoped manifests omit gitHead; provenance supplies the source receipt.

`gh run view 34663522352 --repo poe-platform/poe-code --json headSha,status,conclusion,url` returned **in_progress**, empty conclusion, at `16fd655...` for the [new root release](https://github.com/poe-platform/poe-code/actions/runs/34663522352). Current root publication remains 15.0.24/gitHead `79999cba7bb7bae0581a7a1ba035c4abed6f0397`; [its earlier release](https://github.com/poe-platform/poe-code/actions/runs/34649408167) was freshly rechecked completed/success. Historical holds/failures are not current publication truth. This task did not trigger either release.

The scoped workflow has path filters excluding docs-only changes; the root release runs on main pushes. A documentation commit alone neither proves nor requires a scoped package publication. Local evidence commit: not made by this subtask. Remote evidence delivery: none. Evidence publication: none.

## Inspected-byte identities and safe commit preparation

SHA-256 of files freshly read; README changes were already local and are not adopted by this task:

| Path                                        | SHA-256                                                            |
| ------------------------------------------- | ------------------------------------------------------------------ |
| packages/safe-js/README.md                  | `b13cdcbf9a39c225885678930d6fd5b4ddeefad06a2f189e2cfa2cb3b5dc56b7` |
| README.md                                   | `2ac456a2cc8abad14f65dff1c983d887c12904e4bd05c4938bc9d53e8b31b959` |
| packages/safe-js/src/interp/values.ts       | `f1119b7632f15d45a58934272d9570fd6e9e7c941dfa60209570c4ddaa94116e` |
| packages/safe-js/test/conformance/corpus.ts | `5135528dcb80eb062180ff4a303a83f726b370c88290a0e5bf0a81eafccc7002` |
| .github/workflows/release-safe.yml          | `b3b49c3dd2804cc4871061d00adfe79e64b2af93f944c341bd1c2d4d1e33d7ab` |
| .github/workflows/release.yml               | `9319d98a1a2c8f8dc2a49ac8e2d0abf2807d0e28a535f67dc86503c90082abf7` |
| scripts/package-safe.mjs                    | `5fca8be9caddc3e64d4c5272efdcdaac040eade732e840f69e6b016975c888af` |

`git config --get core.hooksPath` returned `.husky/_`. Husky pre-commit/pre-push wrappers exist but corresponding `.husky/pre-commit` and `.husky/pre-push` scripts do not. The real `.husky/commit-msg` rejects Co-Authored-By. Keep hooks enabled; manually validate the exact final task-owned paths.

Three pre-existing staged files must remain staged and excluded: `packages/safe-bash/src/commands/text.ts`, `packages/safe-bash/tests/commands/helpers.ts`, `packages/safe-bash/tests/commands/text.test.ts`. Safe normal-index approach: snapshot their staged blob IDs, `git add -- <explicit evidence paths>`, inspect `git diff --cached -- <evidence paths>`, then `git commit --only -m 'docs(safejs): establish compatibility baseline evidence' -- <explicit evidence paths>`. Git's only-path commit excludes other staged paths without resetting them. Verify the resulting commit path list and original staged blob IDs afterward. No blanket add, ignored artifacts, hook bypass, branch change, README edit, or unrelated source edit is needed.

No expensive tests were run by this target subtask; source baseline gates belong to the canonical ledger. This receipt must not turn exploratory probes or remote workflow results into local shipped test passes.
