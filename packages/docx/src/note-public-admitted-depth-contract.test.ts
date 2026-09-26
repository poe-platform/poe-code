import { spawn } from "node:child_process";
import { beforeAll, expect, it, onTestFinished } from "vitest";
import { nativeModule, nativeModuleLoader } from "../tests/fixtures/native-module.js";

let script: string;
beforeAll(async () => { script = await nativeModule(new URL("../tests/fixtures/note-depth-public.ts", import.meta.url)); });

for (const strict of [false, true]) for (const depth of [32, 4096])
for (const kind of ["footnote", "endnote"] as const) for (const route of ["sdk", "cli"])
it(`public ${kind} census and body edit retain unselected admitted depth ${depth}; strict=${strict}; ${route}`, async () => {
  const result = await new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", nativeModuleLoader], { stdio: ["pipe", "pipe", "pipe"] });
    onTestFinished(() => { if (child.exitCode === null) child.kill(); });
    let stdout = "", stderr = "";
    child.stdout.on("data", bytes => { stdout += String(bytes); }); child.stderr.on("data", bytes => { stderr += String(bytes); });
    child.on("error", reject); child.on("close", code => code === 0 ? resolve(stdout) : reject(new Error(stderr)));
    child.stdin.on("error", reject);
    child.stdin.end(JSON.stringify(script) + "\n" + JSON.stringify({ strict, depth, kind, route }));
  });
  const data = JSON.parse(result) as { ok: boolean; stack?: string };
  expect(data, data.stack).toEqual({ ok: true, strict, depth, kind, route });
});
