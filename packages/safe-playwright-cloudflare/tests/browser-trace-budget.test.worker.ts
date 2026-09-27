import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import type { BrowserContext, BrowserWorker, Route } from "@cloudflare/playwright";
import { createZipCodec } from "@poe-code/office-package/zip";
import { createCloudflarePlaywrightAdapter } from "../src/index.js";

export default { async fetch(_request: Request, env: { BROWSER: BrowserWorker }) {
  const signal = new AbortController().signal;
  const lease = await createCloudflarePlaywrightAdapter(env.BROWSER, undefined, undefined, {
    traceCapture: "archive", traceLimits: { maxBytes: 256 * 1024, maxFiles: 512, maxArchiveBytes: 64 * 1024 },
  }).acquire({ acquisitionId: "trace-budget", session: "trace-budget", browser: "chromium", headless: true, signal });
  const context = lease.context as unknown as BrowserContext;
  const directory = await mkdtemp("/tmp/trace-budget-fixture-");
  const phase = (name: string) => console.info(`[trace-budget conformance] ${name}`);
  phase("acquired");
  const codec = createZipCodec();
  const zipLimits = { maxArchiveBytes: 64 * 1024, maxEntryBytes: 256 * 1024, maxTotalBytes: 256 * 1024, maxMembers: 512, maxPathBytes: 65535, maxDepth: 32, maxPaxBytes: 65535, maxTextBytes: 65535, chunkSize: 65536 };
  const archive = async (name: string) => codec.readZipArchive(await readFile(`${directory}/${name}.zip`), zipLimits, signal);
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
    await context.tracing.stopChunk({ path: `${directory}/first.zip` });
    phase("first archive");
    const first = await archive("first");
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
    await context.tracing.stop({ path: `${directory}/second.zip` });
    phase("second archive");
    assert.ok((await archive("second")).entries.some(entry => entry.name === "trace.trace"));

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
    await sibling.tracing.stop({ path: `${directory}/sibling.zip` });
    phase("sibling archive");
    assert.ok((await archive("sibling")).entries.some(entry => entry.name === "trace.trace"));
    let overflow: unknown;
    for (let index = 0; index < 20; index++) {
      await page.evaluate(async index => (await (await fetch(`https://trace.test/large-${index}`)).text()).length, index);
      try { await lease.checkTrace!(lease.context, { signal }); }
      catch (error) { overflow = error; break; }
    }
    assert.match(String(overflow), /Browser trace byte limit exceeded/);
    phase("overflow checked");
    await assert.rejects(context.tracing.stop({ path: `${directory}/overflow.zip` }), /Browser trace byte limit exceeded/);
    await assert.rejects(access(`${directory}/overflow.zip`));
    await context.tracing.start({ snapshots: true, screenshots: false });
    assert.deepEqual(await streamers(), originalStreamers);
    await page.locator("p").textContent();
    await lease.checkTrace!(lease.context, { signal });
    await context.tracing.stop({ path: `${directory}/restarted.zip` });
    phase("restarted archive");
    assert.ok((await archive("restarted")).entries.some(entry => entry.name === "trace.trace"));
    await sibling.close();
    return Response.json({ ok: true });
  } catch (error) {
    console.error("[trace-budget conformance] original failure", error);
    throw error;
  } finally { phase("release"); await lease.release(); await rm(directory, { recursive: true, force: true }); phase("released"); }
} };
