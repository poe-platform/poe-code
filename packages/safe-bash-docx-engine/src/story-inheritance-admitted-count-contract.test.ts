import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { prepareNativeModelScript } from "../tests/fixtures/native-model.js";

let native: Awaited<ReturnType<Awaited<ReturnType<typeof prepareNativeModelScript>>>> | undefined;
beforeAll(async () => {
  const startNative = await prepareNativeModelScript(`
try { await exerciseStoryInheritance(request.strict, request.count); console.log(JSON.stringify({ok:true})); }
catch(error) { console.log(JSON.stringify({ok:false,error:String(error),stack:error.stack})); }`,
    `import { exerciseStoryInheritance } from "../tests/fixtures/story-inheritance-depth-public.js";`);
  native = await startNative();
});
afterEach(async () => {
  if (native) expect(JSON.parse(await native.run({ cleanup: true }, new AbortController().signal))).toEqual({ cleaned: true });
});
afterAll(async () => { await native?.dispose(); });

for (const strict of [false, true]) for (const count of [32, 4096])
it(`native public story inherits through ${count} sections; strict=${strict}`, async ({ signal }) => {
  const stdout = await native!.run({ strict, count }, signal);
  const result = JSON.parse(stdout);
  expect(result, result.stack).toEqual({ok:true});
});
