import type { BrowserWorker, Page } from "@cloudflare/playwright";
import { createPlaywrightController } from "@poe-platform/safe-bash/playwright";
import { createZipCodec } from "@poe-code/office-package/zip";
import { createCloudflarePlaywrightAdapter } from "../src/index.js";
import { failureText } from "./browser-native-failure.js";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

export default { async fetch(request: Request, env: { BROWSER: BrowserWorker; LOADER: WorkerLoader }) {
  const controller = createPlaywrightController({
    ...(new URL(request.url).pathname === "/screenshot" ? { limits: { maxArtifactBytes: 65536 } } : {}),
    adapter: createCloudflarePlaywrightAdapter(env.BROWSER, undefined,
    { ownerId: "portable-lifecycle", loader: env.LOADER }, { traceCapture: "archive", traceLimits: {} }) });
  const artifacts = new Map<string, Uint8Array>();
  const signal = AbortSignal.timeout(20000);
  async function run(...args: string[]) {
    let output = "";
    await controller.run({ args, env: {}, signal, async write(text) { output += text; },
      async writeArtifact(bytes, filename) { artifacts.set(filename ?? "artifact", bytes.slice()); } });
    return output;
  }
  let failure: unknown;
  try {
    await run("open");
    const page = controller.inspectSessions()[0]?.context.pages()[0] as Page | undefined;
    check(page, "Missing browser page");
    await page.setContent('<title>Portable browser</title><h1>Portable browser</h1>');
    if (new URL(request.url).pathname === "/run-code") {
      const output = await run("run-code", 'async page => { await page.setViewportSize({width: 32769, height: 1}); await page.evaluate(() => { document.title = "Guest mutation"; }); return {title: await page.title(), bytes: [0, 128, 255]}; }');
      check(output.includes("Guest mutation"), output);
      check(await page.title() === "Guest mutation", "Guest changes did not reach owned page");
      check(page.viewportSize()?.width === 32769, "Large viewport state did not reach owned page");
      const again = await run("run-code", 'async page => page.locator("h1").textContent()');
      check(again.includes("Portable browser"), again);
    } else if (new URL(request.url).pathname === "/screenshot") {
      await run("screenshot", "--filename=/portable.png");
      const png = artifacts.get("/portable.png");
      check(png && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => png[index] === byte), "Screenshot PNG bytes missing");
      check(png.byteLength <= 65536, "Screenshot artifact byte limit exceeded");
    } else {
      await run("tracing-start");
      await page.locator("h1").textContent();
      await run("tracing-stop");
      const bytes = [...artifacts].find(([name]) => name.endsWith(".zip"))?.[1];
      check(bytes, "Trace archive missing");
      const codec = createZipCodec();
      const zipLimits = {
        maxArchiveBytes: Infinity, maxEntryBytes: Infinity, maxTotalBytes: Infinity, maxMembers: Infinity,
        maxPathBytes: Infinity, maxDepth: Infinity, maxPaxBytes: Infinity, maxTextBytes: Infinity, chunkSize: 65536,
      };
      const archive = await codec.readZipArchive(bytes, zipLimits, signal);
      const events = archive.entries.find(entry => entry.name === "trace.trace");
      check(events, "Trace events missing");
      let text = "";
      for await (const chunk of codec.decodeZipEntry(events, zipLimits, signal)) text += new TextDecoder().decode(chunk);
      const actions = text.trim().split("\n").map(line => JSON.parse(line) as { type: string; method?: string });
      check(actions.some(action => action.type === "before" && action.method === "textContent"), "Recorded browser action missing");
      check(archive.entries.some(entry => entry.name === "trace.network"), "Trace network file missing");
      await run("tracing-start");
      await page.title();
      await run("tracing-stop");
    }
  } catch (error) { failure = error; }
  finally {
    try { await controller.dispose(); }
    catch (error) { failure = new AggregateError([failure, error], "Portable lifecycle cleanup failed"); }
  }
  return failure ? Response.json({ error: failureText(failure) }, { status: 500 }) : Response.json({ ok: true });
} };
