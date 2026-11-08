import type { BrowserContext, BrowserWorker } from "@cloudflare/playwright";
import { DurableObject } from "cloudflare:workers";
import { RealFileSystem } from "@poe-code/safe-fs/fs/real";
import { createMemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { createPlaywrightCli } from "@poe-platform/safe-bash/playwright";
import { createCloudflarePlaywrightAdapter } from "../src/index.js";

function fixture(binding: BrowserWorker, failure: string) {
  const fs = createMemoryFileSystem();
  let batch = -1;
  const cli = createPlaywrightCli({
    adapter: createCloudflarePlaywrightAdapter(binding, undefined, undefined, {
      traceCapture: "archive", artifactFileSystem: new RealFileSystem({ root: "/" }), traceLimits: {
        maxBytes: 1024 * 1024, maxFiles: 512, maxArchiveBytes: failure === "archive" ? 512 : 64 * 1024,
      },
    }),
    abilities: {
      open: true, snapshot: true, close: true, "tracing-start": true, "tracing-stop": true,
      requests: { scope: "session", async execute(request) {
        const page = (request.browserSession!.context as unknown as BrowserContext).pages()[0]!;
        if (batch < 0) {
          await page.route("https://trace-shell.test/**", async route => {
            const pathname = new URL(route.request().url()).pathname;
            await route.fulfill({ status: 200, contentType: pathname === "/" ? "text/html" : "text/plain",
              body: pathname === "/" ? "<h1>Trace shell fixture</h1>" : "a".repeat(64 * 1024) + pathname });
          });
          await page.goto("https://trace-shell.test/");
          batch = 0;
          return;
        }
        await page.evaluate(async index => {
          for (let offset = 0; offset < 4; offset++)
            await (await fetch(`https://trace-shell.test/resource-${index * 4 + offset}`)).text();
        }, batch++);
      } },
    },
  });
  return {
    async run(commands: string[]) {
      // A request owns its Shell, while the browser controller survives between requests.
      const shell = new Shell({ fs }).use({ name: cli.plugin.name, setup: cli.plugin.setup });
      try {
        const results = [];
        for (const command of commands) results.push(await shell.exec(`playwright-cli ${command}`));
        return { results, sessions: cli.inspectSessions().map(session => session.name), files: (await fs.readdir("/.playwright-cli")).map(entry => entry.name) };
      } finally { await shell.dispose(); }
    },
    dispose: cli.dispose,
  };
}

interface Env {
  BROWSER: BrowserWorker;
  TRACE: DurableObjectNamespace<TraceShellSessions>;
}

export class TraceShellSessions extends DurableObject<Env> {
  #retained: ReturnType<typeof fixture> | undefined;
  async run(phase: string, failure: string | null) {
    if (phase === "/start") {
      this.#retained = fixture(this.env.BROWSER, failure!);
      return this.#retained.run(["open", "requests", "tracing-start", "requests"]);
    }
    const retained = this.#retained;
    if (!retained) throw new Error("Trace shell fixture has not started");
    if (phase === "/recording") return retained.run(["requests"]);
    if (phase === "/archive") return retained.run(["tracing-stop"]);
    if (phase === "/recover") return retained.run([
      "open data:text/html,%3Ch1%3ERecovered%20browser%3C%2Fh1%3E", "snapshot", "close",
    ]);
    if (phase === "/dispose") { await retained.dispose(); return { ok: true }; }
    throw new Error("Unknown trace shell fixture phase");
  }
}

export default { async fetch(request: Request, env: Env) {
  const url = new URL(request.url);
  try {
    return Response.json(await env.TRACE.getByName("trace-shell").run(url.pathname, url.searchParams.get("failure")));
  } catch (error) {
    console.error("Trace shell fixture failed", error);
    return Response.json({ error: String(error) }, { status: 500 });
  }
} };
