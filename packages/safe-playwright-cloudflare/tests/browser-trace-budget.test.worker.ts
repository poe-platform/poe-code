import assert from "node:assert/strict";
import type { BrowserContext, BrowserWorker, Route } from "@cloudflare/playwright";
import { createZipCodec } from "@poe-code/office-package/zip";
import { createCloudflarePlaywrightAdapter } from "../src/index.js";

export default { async fetch(_request: Request, env: { BROWSER: BrowserWorker }) {
  const signal = new AbortController().signal;
  const lease = await createCloudflarePlaywrightAdapter(env.BROWSER, undefined, undefined, {
    traceCapture: "archive", traceLimits: { maxBytes: 256 * 1024, maxFiles: 512, maxArchiveBytes: 64 * 1024 },
  }).acquire({ acquisitionId: "trace-budget", session: "trace-budget", browser: "chromium", headless: true, signal });
  const context = lease.context as unknown as BrowserContext;
  const phase = (name: string) => console.info(`[trace-budget conformance] ${name}`);
  phase("acquired");
  const codec = createZipCodec();
  const zipLimits = { maxArchiveBytes: 64 * 1024, maxEntryBytes: 256 * 1024, maxTotalBytes: 256 * 1024, maxMembers: 512, maxPathBytes: 65535, maxDepth: 32, maxPaxBytes: 65535, maxTextBytes: 65535, chunkSize: 65536 };
  const captureOptions = { signal, maxBytes: zipLimits.maxArchiveBytes, extension: "zip" };
  const archive = async (produce: (path: string) => Promise<void>) =>
    codec.readZipArchive(await lease.captureArtifact!(produce, captureOptions), zipLimits, signal);
  try {
    // The original context recorder is idle until tracing starts and can close
    // normally. A sibling uses the same provider LocalUtils dispatcher.
    await context.tracing.group("idle group");
    await context.tracing.groupEnd();
    const sibling = await context.browser()!.newContext();
    const siblingPage = await sibling.newPage();
    await sibling.tracing.start({ snapshots: true });
    await siblingPage.setContent("<p>Sibling trace</p>");
    phase("sibling recording");
    const page = await context.newPage();
    const pendingRoute = Promise.withResolvers<Route>();
    await page.route("https://trace.test/**", async route => {
      const url = new URL(route.request().url());
      if (url.pathname === "/pending") { pendingRoute.resolve(route); return; }
      await route.fulfill({ status: 200, contentType: url.pathname === "/" ? "text/html" : "text/plain",
        body: url.pathname === "/" ? "<p>Trace fixture</p>" : `${"a".repeat(url.pathname.includes("large") ? 64 * 1024 : 8192)}${url.pathname}` });
    });
    await page.goto("https://trace.test/");
    phase("page ready");
    await context.tracing.start({ snapshots: true, screenshots: false });
    const streamers = () => page.evaluate(() => Object.getOwnPropertyNames(window).filter(name => name.startsWith("__playwright_snapshot_streamer_")).sort());
    const originalStreamers = await streamers();
    assert.equal(originalStreamers.length, 1);
    await context.tracing.group("first group");
    await page.evaluate(async () => (await (await fetch("https://trace.test/small")).text()).length);
    await context.tracing.groupEnd();
    await lease.checkTrace!(lease.context, { signal });
    phase("first capture");
    const first = await archive(path => context.tracing.stopChunk({ path }));
    phase("first archive");
    assert.ok(first.entries.some(entry => entry.name === "trace.trace"));
    assert.ok(first.entries.some(entry => entry.name === "trace.network"));
    assert.ok(first.entries.some(entry => entry.name.startsWith("resources/")));
    assert.ok(first.entries.some(entry => entry.name === "trace.stacks"));
    await context.tracing.startChunk({ title: "second chunk" });
    await page.title();
    await page.evaluate(() => { void fetch("https://trace.test/pending").catch(() => {}); });
    const heldRoute = await pendingRoute.promise;
    const bridge = (context.tracing as unknown as { _connection: { toImpl(value: unknown): unknown } })._connection;
    const nativeTracing = bridge.toImpl(context.tracing) as { _snapshotter: { _delegate: { _harTracer: { _entrySymbol: symbol } } } };
    const requestSymbol = nativeTracing._snapshotter._delegate._harTracer._entrySymbol;
    const nativeRequest = bridge.toImpl(heldRoute.request()) as Record<symbol, { request: { url: string; headers: unknown[] } } | undefined>;
    const pendingEntry = nativeRequest[requestSymbol];
    assert.ok(pendingEntry);
    assert.equal(pendingEntry.request.url, "https://trace.test/pending");
    const second = await archive(path => context.tracing.stop({ path }));
    phase("second archive");
    assert.ok(second.entries.some(entry => entry.name === "trace.trace"));

    await context.tracing.start({ snapshots: true, screenshots: false });
    assert.deepEqual(await streamers(), originalStreamers);
    assert.equal(nativeRequest[requestSymbol], undefined);
    assert.equal(pendingEntry.request.url, "");
    assert.deepEqual(pendingEntry.request.headers, []);
    assert.equal(heldRoute.request().url(), "https://trace.test/pending");
    await heldRoute.abort();
    await page.evaluate(async () => (await (await fetch("https://trace.test/small")).text()).length);
    await lease.checkTrace!(lease.context, { signal });
    // Restarting the bounded recorder must not discard sibling stack sessions.
    const siblingArchive = await archive(path => sibling.tracing.stop({ path }));
    phase("sibling archive");
    assert.ok(siblingArchive.entries.some(entry => entry.name === "trace.trace"));
    let overflow: unknown;
    for (let index = 0; index < 20; index++) {
      await page.evaluate(async index => (await (await fetch(`https://trace.test/large-${index}`)).text()).length, index);
      try { await lease.checkTrace!(lease.context, { signal }); }
      catch (error) { overflow = error; break; }
    }
    assert.match(String(overflow), /Browser trace byte limit exceeded/);
    phase("overflow checked");
    // A rejected recorder must leave no archive in the provider filesystem.
    await assert.rejects(lease.captureArtifact!(async path => {
      await assert.rejects(context.tracing.stop({ path }), /Browser trace byte limit exceeded/);
    }, captureOptions), { code: "ENOENT" });
    await context.tracing.start({ snapshots: true, screenshots: false });
    assert.deepEqual(await streamers(), originalStreamers);
    await page.locator("p").textContent();
    await lease.checkTrace!(lease.context, { signal });
    const restarted = await archive(path => context.tracing.stop({ path }));
    phase("restarted archive");
    assert.ok(restarted.entries.some(entry => entry.name === "trace.trace"));
    await sibling.close();
    return Response.json({ ok: true });
  } catch (error) {
    console.error("[trace-budget conformance] original failure", error);
    throw error;
  } finally { phase("release"); await lease.release(); phase("released"); }
} };
