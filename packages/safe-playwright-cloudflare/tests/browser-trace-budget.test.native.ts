import { expect, test } from "vitest";
import { Miniflare } from "miniflare";
import { buildNativeFixture } from "./browser-native-fixture.js";

test("pinned native tracing uses bounded archives, isolates siblings, and restarts after a recording overflow", async () => {
  const script = await buildNativeFixture(new URL("./browser-trace-budget.test.worker.ts", import.meta.url));
  const worker = new Miniflare({ modules: true, script, compatibilityDate: "2026-07-08", compatibilityFlags: ["nodejs_compat"], browserRendering: { binding: "BROWSER" } });
  try {
    const response = await worker.dispatchFetch("http://fixture/");
    const body = await response.text();
    expect(response.status, body).toBe(200);
    expect(JSON.parse(body)).toEqual({ ok: true });
  } finally { await worker.dispose(); }
});
