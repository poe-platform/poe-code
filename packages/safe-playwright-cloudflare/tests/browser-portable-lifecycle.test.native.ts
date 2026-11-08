import { expect, test } from "vitest";
import { Miniflare } from "miniflare";
import { buildNativeFixture, disposeNativeFixture } from "./browser-native-fixture.js";

test.each(["run-code", "screenshot", "trace"])("workerd without Node compatibility executes %s through the public controller", async scenario => {
  const script = await buildNativeFixture(new URL("./browser-portable-lifecycle.test.worker.ts", import.meta.url), ["workerd"]);
  const worker = new Miniflare({ modules: true, script, compatibilityDate: "2026-07-08",
    browserRendering: { binding: "BROWSER" }, workerLoaders: { LOADER: {} } });
  try {
    const response = await worker.dispatchFetch(`http://fixture/${scenario}`);
    const body = await response.text();
    expect(response.status, body).toBe(200);
    expect(JSON.parse(body)).toEqual({ ok: true });
  } finally { await disposeNativeFixture(worker); }
});
