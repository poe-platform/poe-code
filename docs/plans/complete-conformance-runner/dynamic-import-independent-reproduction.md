# Dynamic import fixture qualification counterexample

Observed on the frozen v2 runner at source SHA `f314e261c96e444b8fc983117864462171db5bc4`, source hash `babb6a32e2a69931606306fe865366da0fd52a3d368c220b314b8f83a80321cc`, Node v22.23.2 / ICU 78.2. No runtime or runner source changed for this probe.

The pinned `language/expressions/dynamic-import/import-errored-module.js` passes both variants (294.88 ms total), but never evaluates its fixture. The fixture throws `new Error("boom")`; the runner has no module environment, so the interpreter rejects with an unrelated generic `Error` about no registered modules. The fixture only checks the constructor, allowing the denial to satisfy its assertions. A neighboring strengthened check for the fixture's actual error message fails both variants with `async-failure` (196.07 ms total). This is a runner module-loader qualification gap, not evidence of an ECMAScript defect in host denial itself.

The published target permits host-defined loading and abrupt completion: [ECMA-262 edition 16 §16.2.1.10](https://262.ecma-international.org/16.0/#sec-HostLoadImportedModule). [§13.3.10.3](https://262.ecma-international.org/16.0/#sec-ContinueDynamicImport) propagates load, link and evaluation rejection. An absent loader cannot qualify the pinned fixture's evaluation/cache behavior. The fetched official edition hash remains `6a28f9423133ed7b7c59a40baf620c2740f12f0bc9c251042f2a85b9cc5ed713`.

The resolver denial is `Error`, not `TypeError`. Import argument coercion and options validation can legitimately reject before host loading; those passing fixtures require scoped classification rather than treating every dynamic-import feature row as a demonstrated false pass. Nonempty valid import attributes are also denied by the registered-module policy, so runtime feature coverage remains unqualified where that denial substitutes for loading.

Exact reproduction (stdin only; no fixture files created):

```sh
node --import tsx --input-type=module <<'JS'
import {readFileSync} from 'node:fs';
import {executeTest262} from './packages/safe-js/test/conformance/execute.ts';
const root='/private/tmp/safejs-baseline-test262-419d3e0';
const harness=new Map(['assert.js','sta.js','doneprintHandle.js','asyncHelpers.js'].map(n=>[n,readFileSync(`${root}/harness/${n}`,'utf8')]));
for(const [label,source] of [
['pinned',readFileSync(`${root}/test/language/expressions/dynamic-import/import-errored-module.js`,'utf8')],
['message-control','/*---\nflags: [async]\nfeatures: [dynamic-import]\nincludes: [asyncHelpers.js]\n---*/\nasyncTest(async()=>{try{await import("./import-errored-module_FIXTURE.js");$DONE("missing rejection")}catch(e){assert.sameValue(e.message,"boom")}});']]) {
const start=performance.now(); const result=await executeTest262(label+'.js',source,{harness,timeoutMs:3000});console.log(JSON.stringify({label,elapsedMs:performance.now()-start,result}));
}
JS
```

Command exit 0 is probe completion, not qualification success. Expected qualification: the fixture must execute and its repeated import must follow the pinned module lifecycle, or these variants must be explicit unsupported nonpasses. Actual raw result: two passes despite no loader. Owner: `complete-conformance-runner` admission/reporting and dedicated module fixture loader repair. Retain v2 raw records; never rewrite them silently. A source repair requires a new source identity and validated reporting disposition.

## Admission repair receipt

Before changing execution code, `npx vitest run packages/safe-js/test/conformance/execute.test.ts` reproduced **5 failed / 25 passed**, exit 1, 5.85 s (2026-09-12 01:28:33 CDT / 06:28:33 UTC). The in-memory reduction of the pinned Error-only repeated import produced two unexpected passes; raw positive cases for each of four module-related features also passed instead of being unsupported.

`execute.ts` now admits those feature requirements only for parse-negative scripts: `dynamic-import`, `import-defer`, `source-phase-imports`, and `source-phase-imports-module-source`. All other variants carrying these requirements are explicit `unsupported/module` before harness execution, including raw, runtime-negative, and syntax-only positive cases until finer capability scopes are qualified. Existing module-flag admission remains unsupported for every phase. This uses parsed metadata, not source substrings. Reporting independently checked the pinned metadata census and found 595 nonmodule/nonparse files / 1,153 variants in this union; related JSON, attributes, text and bytes imports are covered. A lexical corroboration found no known unmarked runtime imports; property methods named import are not denied by substring matching.

The focused command then passed **30/30**, exit 0, 4.73 s (01:28:44 CDT / 06:28:44 UTC). `npx vitest run packages/safe-js/test/conformance` passed **145/145 across 10 files**, exit 0, 7.60 s (01:28:56 CDT / 06:28:56 UTC), including preserved parse-negative controls. A fresh exact pinned fixture probe returns `unsupported/module` in both modes. All tests remain in memory; no runtime source changed or budget/timeout/assertion weakened. A new manifest/full run is required; v2 records remain historical and cannot qualify this source revision.

Final static checks: `npx eslint packages/safe-js/test/conformance/execute.ts packages/safe-js/test/conformance/execute.test.ts` exit 0; `npx tsc --noEmit -p packages/safe-js/tsconfig.json` exit 0 (8.71 s). No source changes after these checks.
