import { afterAll, beforeAll, expect, test } from "vitest";
import { Miniflare } from "miniflare";
import { buildNativeFixture, disposeNativeFixture } from "./browser-native-fixture";
import { serveOrigin } from "./node-origin.fixture";

let worker: Miniflare;
let server: Awaited<ReturnType<typeof serveOrigin>>;
beforeAll(async () => {
  server = await serveOrigin();
  const script = await buildNativeFixture(new URL("./browser-snapshot-navigation.test.worker.ts", import.meta.url));
  worker = new Miniflare({ modules: true, script, compatibilityDate: "2026-07-08",
    compatibilityFlags: ["nodejs_compat"], browserRendering: { binding: "BROWSER" } });
  await worker.ready;
}, 30000);
afterAll(async () => {
  try { if (worker) await disposeNativeFixture(worker); }
  finally { await server?.stop(); }
});

for (const mode of ["native", "json", "fallback"]) test(`${mode} retires iframe refs across document replacement and snapshot refresh`, async () => {
  const response = await worker.dispatchFetch(`http://fixture/${mode}`, { method: "POST", body: server.url.origin });
  expect(await response.json()).toEqual({ ok: true });
}, 30000);
