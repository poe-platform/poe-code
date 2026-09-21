import { spawn } from "node:child_process";
import { expect, it } from "vitest";
import { exerciseStoryRelink } from "../tests/fixtures/story-relink-depth-public.js";

for (const strict of [false, true]) for (const depth of [32, 4096])
it(`native public story relinking preserves admitted XML depth ${depth}; strict=${strict}`, async () => {
  const request = { strict, depth, kind: "docx", story: "header", variant: "default", shared: false };
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
      `import { exerciseStoryRelink } from './packages/docx/tests/fixtures/story-relink-depth-public.ts';
       let input=''; for await (const bytes of process.stdin) input+=bytes;
       try { await exerciseStoryRelink(JSON.parse(input)); console.log(JSON.stringify({ok:true})); }
       catch(error) { console.log(JSON.stringify({ok:false, error:String(error), stack:error.stack})); }`], { stdio: ["pipe", "pipe", "pipe"] });
    let output = "", stderr = "";
    child.stdout.on("data", bytes => { output += String(bytes); });
    child.stderr.on("data", bytes => { stderr += String(bytes); });
    child.on("error", reject); child.on("close", code => code === 0 ? resolve(output) : reject(new Error(stderr)));
    child.stdin.end(JSON.stringify(request));
  });
  const result = JSON.parse(stdout);
  expect(result, result.stack).toEqual({ ok: true });
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const story of ["header", "footer"] as const) for (const variant of ["default", "first", "even"] as const)
for (const shared of [false, true])
it(`relinks ${story}/${variant} while retaining raw owners; ${kind}; strict=${strict}; shared=${shared}`, async () => {
  await exerciseStoryRelink({ strict, kind, story, variant, shared, depth: 32 });
});
