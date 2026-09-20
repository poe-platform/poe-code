import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

for (const strict of [false, true])
it(`preserves an original deeply opaque numbering definition during new-list allocation; strict=${strict}`, async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../tests/fixtures/deep-numbering-opaque-definition-worker.ts", import.meta.url)), strict ? "strict" : "transitional"]);
  expect(JSON.parse(stdout)).toEqual({ strict, depth: 4096, exactOpaqueDefinitionPreservation: true });
});

for (const strict of [false, true]) for (const depth of [64, 4096])
for (const route of ["sdk", "sdk-batch", "cli", "cli-batch"]) for (const action of ["edit", "dry"])
it(`preserves original opaque numbering under public default/trusted host semantics; strict=${strict}; depth=${depth}; route=${route}; action=${action}`, async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../tests/fixtures/deep-numbering-opaque-definition-worker.ts", import.meta.url)), strict ? "strict" : "transitional", String(depth), route, action]);
  expect(JSON.parse(stdout)).toEqual({ strict, depth, exactOpaqueDefinitionPreservation: true, route, dryRun: action === "dry", actualPublicDispatchAndRetention: true });
});
