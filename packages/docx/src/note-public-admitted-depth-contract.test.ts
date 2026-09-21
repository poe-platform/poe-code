import { spawn } from "node:child_process";
import { expect, it } from "vitest";
for (const strict of [false, true]) for (const depth of [32, 4096])
for (const kind of ["footnote", "endnote"] as const) for (const route of ["sdk", "cli"])
it(`public ${kind} census and body edit retain unselected admitted depth ${depth}; strict=${strict}; ${route}`, async () => {
  const result = await new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "packages/docx/tests/fixtures/note-depth-public.ts"], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", bytes => { stdout += String(bytes); }); child.stderr.on("data", bytes => { stderr += String(bytes); });
    child.on("error", reject); child.on("close", code => code === 0 ? resolve(stdout) : reject(new Error(stderr)));
    child.stdin.end(JSON.stringify({ strict, depth, kind, route }));
  });
  const data = JSON.parse(result) as { ok: boolean; stack?: string };
  expect(data, data.stack).toEqual({ ok: true, strict, depth, kind, route });
});
