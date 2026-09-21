import { spawn } from "node:child_process";
import { expect, it } from "vitest";

// A normal Node host has a smaller stack than Vitest's worker. The child uses
// memfs only and the public exports; explicit depth ceilings are caller authority.
for (const strict of [false, true]) for (const depth of [32, 4096])
for (const action of ["read", "rename", "remove"] as const) for (const route of ["sdk", "cli"])
it(`public bookmark ${action} retains native graph at admitted depth ${depth}; strict=${strict}; ${route}`, async () => {
  const result = await new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "packages/docx/tests/fixtures/bookmark-depth-public.ts"], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", bytes => { stdout += String(bytes); });
    child.stderr.on("data", bytes => { stderr += String(bytes); });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve(stdout) : reject(new Error(stderr)));
    child.stdin.end(JSON.stringify({ strict, depth, action, route }));
  });
  const data = JSON.parse(result) as { ok: boolean; stack?: string };
  expect(data, data.stack).toEqual({ ok: true, strict, depth, action, route });
});
