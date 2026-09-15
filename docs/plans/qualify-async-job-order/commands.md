# Reproduce async-job qualification

Run from the repository root on the fingerprinted source. The tests write no fixture files. Output logs below are command receipts, not fixture inputs. Use new report paths for conformance reruns: the maintained runner deliberately opens them exclusively.

## Maintained checks

```sh
npm run build:workspaces -- --workspace=@poe-code/safe-js
npm test --workspace=@poe-code/safe-js
npx vitest run \
  packages/safe-js/test/async-job-order-qualification.test.ts \
  packages/safe-js/test/async-generator-return-order.test.ts \
  packages/safe-js/test/async-delegated-return-restore.test.ts \
  packages/safe-js/test/async-rejection-policy-qualification.test.ts \
  packages/safe-js/test/async-lifecycle-qualification.test.ts \
  packages/safe-js/test/promise-finally-handler-metadata.test.ts \
  packages/safe-js/src/snapshot/async-function-continuations.test.ts \
  packages/safe-js/src/snapshot/async-generator-validation.test.ts \
  packages/safe-js/src/snapshot/pending-promise-continuations.test.ts \
  packages/safe-js/src/snapshot/thenable-continuations.test.ts \
  packages/safe-js/src/interp/globals/promise-try.test.ts \
  packages/safe-js/src/interp/globals/promise-with-resolvers.test.ts
npx eslint \
  packages/safe-js/src/interp/async-generator-driver.ts \
  packages/safe-js/src/interp/generator-expression-state.ts \
  packages/safe-js/src/interp/interpreter.ts \
  packages/safe-js/src/interp/promise.ts \
  packages/safe-js/src/snapshot/guest-ast-validation.ts \
  packages/safe-js/src/snapshot/guest-heap-validation.ts \
  packages/safe-js/test/async-job-order-qualification.test.ts \
  packages/safe-js/test/async-generator-return-order.test.ts \
  packages/safe-js/test/async-delegated-return-restore.test.ts \
  packages/safe-js/test/async-rejection-policy-qualification.test.ts \
  packages/safe-js/test/async-lifecycle-qualification.test.ts \
  packages/safe-js/test/promise-finally-handler-metadata.test.ts
```

Pinned fixture command arrays are JSON, including every exact `--include`. Reproduce a selection without changing its budgets or deadlines:

```sh
python3 - <<'PY'
import json, subprocess
args = json.load(open('docs/plans/qualify-async-job-order/pinned-final-command.json'))
args[args.index('--report') + 1] = '../../docs/plans/qualify-async-job-order/pinned-reproduction.jsonl'
raise SystemExit(subprocess.run(args).returncode)
PY
```

## Built Node/Bun runtime traces

The `runtime-traces.json` inputs are the literal `cases` array in the ordering test, extracted using the TypeScript parser. They contain guest source and the same specification-derived expectations, not native-engine-generated expectations. For each binary in `runtime-commands.json`, execute this code on stdin (`node --input-type=module`, or `bun run -`). The original subprocess wrapper imposed an unchanged 60-second outer failure deadline; no timer determines event order.

```js
import fs from "node:fs";
import { isDeepStrictEqual } from "node:util";
import {
  run,
  dump,
  restore,
  declareHostOperation,
  deepCopyFromSandbox
} from "./packages/safe-js/dist/index.js";

const traces = JSON.parse(
  fs.readFileSync("docs/plans/qualify-async-job-order/runtime-traces.json", "utf8")
);
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const records = [];
for (const { name, body, expected } of traces) {
  const source = `const trace=[];await gate();${body}return trace;`;
  let release, entered;
  const gate = new Promise((r) => {
    release = r;
  });
  const ready = new Promise((r) => {
    entered = r;
  });
  let calls = 0;
  const execution = run(source, {
    bindings: {
      gate: declareHostOperation(() => {
        calls++;
        entered();
        return gate;
      }, "re-issue")
    }
  });
  const record = { name };
  try {
    record.native = await new AsyncFunction("gate", source)(async () => {});
    await ready;
    const pending = await dump(execution, { mode: "replay" });
    release();
    const original = await execution;
    if (!original.ok) throw new Error(JSON.stringify(original));
    record.original = deepCopyFromSandbox(original.returnValue);
    const bindings = {
      gate: declareHostOperation(() => {
        calls++;
        return Promise.resolve();
      }, "re-issue")
    };
    const resumed = await run(source, {
      bindings,
      snapshot: restore(JSON.parse(pending), { source })
    });
    if (!resumed.ok) throw new Error(JSON.stringify(resumed));
    record.resumed = deepCopyFromSandbox(resumed.returnValue);
    const completed = await dump(resumed);
    const replayed = await run(source, {
      bindings,
      snapshot: restore(JSON.parse(completed), { source })
    });
    if (!replayed.ok) throw new Error(JSON.stringify(replayed));
    record.replayed = deepCopyFromSandbox(replayed.returnValue);
    record.hostCalls = calls;
    record.pass =
      calls === 2 &&
      ["native", "original", "resumed", "replayed"].every((k) =>
        isDeepStrictEqual(record[k], expected)
      );
  } catch (error) {
    record.error = String(error);
    record.pass = false;
    release();
  }
  records.push(record);
}
console.log(
  JSON.stringify(
    {
      versions: process.versions,
      records,
      pass: records.every((r) => r.pass)
    },
    null,
    2
  )
);
if (records.some((r) => !r.pass)) process.exitCode = 1;
```

Retain Node18/Bun's exit 1 and native trace differences. The separate disposition compares the three **SafeJS** fields and exact host count with the same expected array. Do not turn an old native engine into the edition oracle.

## Workerd public-entrypoint check

Use the installed `workerd 2026-09-11`, npm package `1.20260911.1`, or `npm exec --yes --package=workerd@1.20260911.1 -- workerd` after verifying its reported version. Generate an ephemeral bundle/config, without changing project source or package configuration:

```js
import { build } from "esbuild";
import { resolveWorkerdRuntimeBuild } from "./scripts/bundle-fs.mjs";
import fs from "node:fs";
const traces = fs.readFileSync("docs/plans/qualify-async-job-order/runtime-traces.json", "utf8");
const dir = "/tmp/safejs-async-workerd";
fs.mkdirSync(dir, { recursive: true });
const options = resolveWorkerdRuntimeBuild(process.cwd(), { alias: {}, external: ["node:*"] });
delete options.entryPoints;
delete options.outdir;
const source = `import {run} from './packages/safe-js/src/workerd.ts';
const cases=${traces};export default{async test(){const records=[];
for(const {name,body,expected} of cases){const result=await run('const trace=[];'+body+'return trace;');
const actual=result.returnValue;const pass=result.ok&&JSON.stringify(actual)===JSON.stringify(expected);
records.push({name,actual,expected,pass});}
console.log(JSON.stringify({records}));if(records.some(r=>!r.pass))throw new Error('Async trace mismatch');}};`;
const output = await build({
  ...options,
  stdin: { contents: source, resolveDir: process.cwd(), sourcefile: "async-workerd-test.mjs" },
  outfile: dir + "/worker.mjs",
  sourcemap: false
});
fs.writeFileSync(dir + "/worker.mjs", output.outputFiles[0].contents);
fs.writeFileSync(
  dir + "/config.capnp",
  `using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (services = [(name = "async-order", worker = (
modules = [(name = "worker.mjs", esModule = embed "worker.mjs")],
compatibilityDate = "2026-09-01", compatibilityFlags = ["nodejs_compat"]
))]);\n`
);
```

```sh
npm exec --yes --package=workerd@1.20260911.1 -- workerd test /tmp/safejs-async-workerd/config.capnp
```

This public entrypoint does not export dump/restore. The check does not invent an unsupported public replay surface.

## Separate fixture assertions from rejection policy

Execute the code below using `node --import tsx --input-type=module`. It leaves every fixture and harness byte unchanged and records both outcomes. No fixture is marked passed by this diagnostic.

```js
import fs from "node:fs/promises";
import { createTest262Realm } from "./packages/safe-js/test/conformance/realm.ts";
import { prepareTest262 } from "./packages/safe-js/test/conformance/metadata.ts";
const args = JSON.parse(
  await fs.readFile("docs/plans/qualify-async-job-order/pinned-after-command.json", "utf8")
);
const filenames = [];
for (let i = 0; i < args.length; i++) if (args[i] === "--include") filenames.push(args[++i]);
const selected = filenames.filter(
  (f) =>
    f.endsWith("invoke-resolve-error-close.js") ||
    f.endsWith("invoke-then-error-close.js") ||
    f.endsWith("subclass-species-constructor-reject-count.js")
);
const root = "/tmp/safejs-baseline-test262-419d3e0";
const records = [];
for (const filename of selected) {
  const source = await fs.readFile(root + "/test/" + filename, "utf8");
  const prepared = prepareTest262(filename, source);
  for (const variant of prepared.variants) {
    const realm = createTest262Realm({ deadline: Date.now() + 3000 });
    try {
      for (const include of variant.harness) {
        const outcome = await realm.evaluate(
          await fs.readFile(root + "/harness/" + include, "utf8")
        );
        if (outcome.status !== "normal") throw new Error("harness failed");
      }
      const evaluation = await realm.evaluate(variant.source);
      const settlement = await realm.settle();
      records.push({
        filename,
        mode: variant.mode,
        flags: prepared.flags,
        evaluation: evaluation.status,
        settlement: settlement.status
      });
    } finally {
      await realm.dispose();
    }
  }
}
console.log(JSON.stringify({ versions: process.versions, records }, null, 2));
```

## Cancellation through pending restore and completed replay

Run on the built SDK with `node --import tsx --input-type=module`. The receipt retains the full guest source. The host owns the AbortControllers and the deliberately never-settling gate.

```js
import fs from "node:fs";
import {
  run,
  dump,
  restore,
  declareHostOperation,
  deepCopyFromSandbox
} from "./packages/safe-js/dist/index.js";
import { bounded, deferred } from "./packages/safe-js/test/fixtures/final-async-proof.ts";
const { source } = JSON.parse(
  fs.readFileSync("docs/plans/qualify-async-job-order/cancellation-replay-probe.json", "utf8")
);
let entered = deferred();
let calls = 0;
const bindings = {
  gate: declareHostOperation(() => {
    calls++;
    entered.release();
    return new Promise(() => {});
  }, "re-issue")
};
const controller = new AbortController();
const execution = run(source, { bindings, signal: controller.signal });
await bounded(entered.promise, "original entry");
const pending = await bounded(dump(execution, { mode: "replay" }), "pending capture");
controller.abort(new Error("stop"));
const original = await bounded(execution, "cancelled original");
entered = deferred();
const resumedController = new AbortController();
const resumedExecution = run(source, {
  bindings,
  signal: resumedController.signal,
  snapshot: restore(JSON.parse(pending), { source })
});
await bounded(entered.promise, "resumed entry");
resumedController.abort(new Error("stop"));
const resumed = await bounded(resumedExecution, "cancelled resume");
const completed = await bounded(dump(resumed), "cancelled completed capture");
const replayed = await bounded(
  run(source, {
    bindings,
    snapshot: restore(JSON.parse(completed), { source })
  }),
  "cancelled completed replay"
);
for (const result of [original, resumed, replayed]) {
  if (
    !result.ok ||
    JSON.stringify(deepCopyFromSandbox(result.returnValue)) !== '["finally","stop"]'
  )
    throw new Error("Cancellation trace mismatch");
}
if (calls !== 2) throw new Error("Duplicated or suppressed gate");
console.log({ calls, trace: ["finally", "stop"] });
```

## Ad-hoc visual CLI check

Execute the committed guest input through the scoped executable, then open and inspect the reported PNG. Expect an unclipped successful JSON object with `trace: ["start","tick 1","get then","tick 2"]` and `handlerLengths: [1,1]`.

```sh
npm run screenshot -- node packages/safe-js/dist/cli.js docs/plans/qualify-async-job-order/ordering.safejs
```

The generic maintained screenshot command targets SafeJS directly. No root predev build, LLM, filesystem grant or snapshot test is involved.
