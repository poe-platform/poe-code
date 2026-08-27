import { run, save, snapshot } from "./evidence-tools.mjs";

snapshot("evidence/pre-final-check.json");
const results = [];
results.push(await run("final-streaming", process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", "tests/commands/search-stress/streaming.test.ts"], 180000, { HARNESS_TIMING: "1" }));
results.push(await run("final-negative-controls", process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", "tests/stress/harness-timing-20260827/negative-controls.ts"], 60000, { HARNESS_TIMING: "1" }));
results.push(await run("final-scoped-types", process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit", "-p", "tests/stress/harness-timing-20260827/tsconfig.scope.json"]));
save("evidence/final-check-results.json", results.map(({ events, ...result }) => result));
snapshot("evidence/post-final-check.json");
console.log(JSON.stringify(results.map(({ name, code, signal, failure, durationMs }) => ({ name, code, signal, failure, durationMs })), null, 2));
