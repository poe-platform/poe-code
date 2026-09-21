import { spawn } from "node:child_process";
import { expect, it } from "vitest";

for (const strict of [false, true]) for (const count of [32, 4096])
it(`native public story inherits through ${count} sections; strict=${strict}`, async () => {
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
      `import { exerciseStoryInheritance } from './packages/docx/tests/fixtures/story-inheritance-depth-public.ts';
       let input=''; for await (const bytes of process.stdin) input+=bytes;
       const {strict,count}=JSON.parse(input);
       try { await exerciseStoryInheritance(strict,count); console.log(JSON.stringify({ok:true})); }
       catch(error) { console.log(JSON.stringify({ok:false,error:String(error),stack:error.stack})); }`], { stdio: ["pipe", "pipe", "pipe"] });
    let output = "", stderr = "";
    child.stdout.on("data", bytes => { output += String(bytes); });
    child.stderr.on("data", bytes => { stderr += String(bytes); });
    child.on("error", reject); child.on("close", code => code === 0 ? resolve(output) : reject(new Error(stderr)));
    child.stdin.end(JSON.stringify({strict,count}));
  });
  const result = JSON.parse(stdout);
  expect(result, result.stack).toEqual({ok:true});
});
