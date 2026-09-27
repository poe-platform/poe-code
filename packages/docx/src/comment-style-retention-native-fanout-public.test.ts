import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { prepareNativeModelScript } from "../tests/fixtures/native-model.js";

let native: Awaited<ReturnType<Awaited<ReturnType<typeof prepareNativeModelScript>>>> | undefined;
beforeAll(async () => {
  const startNative = await prepareNativeModelScript(`
try {
  await verifyCommentStyleRetention(request);
  console.log(JSON.stringify({ ok: true }));
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: String(error), stack: error instanceof Error ? error.stack : undefined }));
}`, `import { verifyCommentStyleRetention } from "../tests/fixtures/comment-style-retention-native.js";`);
  native = await startNative();
});
afterEach(async () => {
  if (native) expect(JSON.parse(await native.run({ cleanup: true }, new AbortController().signal))).toEqual({ cleaned: true });
});
afterAll(async () => { await native?.dispose(); });

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const count of [1024]) for (const route of ["model", "sdk", "cli"] as const)
it(`rich comment style creation retains admitted ignored physical fanout; strict=${strict}; kind=${kind}; count=${count}; route=${route}`, async ({ signal }) => {
  const response = JSON.parse(await native!.run({ strict, kind, count, route }, signal)) as { error?: string; stack?: string };
  expect(response, response.stack ?? response.error).toEqual({ ok: true });
});
