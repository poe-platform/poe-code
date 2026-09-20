import { DurableObject } from "cloudflare:workers";
import { sessions, type BrowserWorker } from "@cloudflare/playwright";
import { checkpointBrowserProfile, createPlaywrightCli } from "@poe-platform/safe-bash/playwright";
import { agentCommands, createMemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { createCloudflarePlaywrightAdapter } from "../src/index.js";

interface Env {
  BROWSER: BrowserWorker;
  SESSIONS: DurableObjectNamespace<CapacitySessions>;
}

export class CapacitySessions extends DurableObject<Env> {
  #requests: { method: string; url: string }[] = [];
  #cli = createPlaywrightCli({
    adapter: createCloudflarePlaywrightAdapter({
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        this.#requests.push({ method: init?.method ?? "GET", url: String(input) });
        return this.env.BROWSER.fetch(input, init);
      }
    } as BrowserWorker),
    limits: { maxSessions: 2 },
    persistence: {
      async restore() {
        return undefined;
      },
      async checkpoint(session, signal) {
        await checkpointBrowserProfile(session, { maxBytes: 2 * 1024 * 1024, maxTabs: 8 }, signal);
      },
      async delete() {}
    }
  });
  #fs = createMemoryFileSystem();

  async run(command: string) {
    const before = this.#requests.length;
    const shell = new Shell({ fs: this.#fs })
      .use(agentCommands())
      .use({ name: this.#cli.plugin.name, setup: this.#cli.plugin.setup });
    const signal = new AbortController();
    let result;
    try {
      result = await shell.exec(command, { signal: signal.signal });
    } finally {
      await shell.dispose();
      signal.abort(new Error("Shell call finished"));
    }
    return {
      command,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      requests: this.#requests.slice(before),
      sessions: await sessions(this.env.BROWSER)
    };
  }

  async dispose() {
    await this.#cli.dispose();
    return { sessions: await sessions(this.env.BROWSER) };
  }
}

export default {
  async fetch(request: Request, env: Env) {
    const origin = await request.text();
    const owner = env.SESSIONS.getByName("capacity-owner");
    const results = [];
    try {
      for (let command of [
        `PLAYWRIGHT_CLI_SESSION=first playwright-cli open; playwright-cli -s first tab-new ${origin}/set-cookies`,
        "PLAYWRIGHT_CLI_SESSION=ignored playwright-cli -s second open; playwright-cli -s second tab-list",
        "playwright-cli -s third open",
        "playwright-cli -s first tab-list",
        `playwright-cli -s first goto ${origin}/cookies; playwright-cli -s first snapshot`,
        `playwright-cli -s second goto ${origin}/cookies; playwright-cli -s second snapshot`,
        "playwright-cli close-all",
        "playwright-cli list",
        `playwright-cli open ${origin}/; playwright-cli tab-new ${origin}/`,
        "playwright-cli snapshot",
        "playwright-cli close",
        `playwright-cli open ${origin}/upload-test`,
        "playwright-cli snapshot",
        "playwright-cli click <upload-ref>",
        "for i in $(seq 1 30); do playwright-cli snapshot > /upload-progress.txt || exit 1; if grep -q 'Uploads finished' /upload-progress.txt; then cat /upload-progress.txt; exit 0; fi; done; cat /upload-progress.txt; exit 1",
        "playwright-cli close-all"
      ]) {
        if (command === "playwright-cli click <upload-ref>") {
          const snapshot = results.at(-1)!.stdout;
          const start = snapshot.indexOf("[ref=");
          const end = snapshot.indexOf("]", start);
          if (start === -1 || end === -1) throw new Error("Upload button snapshot ref missing");
          command = `playwright-cli click ${snapshot.slice(start + 5, end)}`;
        }
        results.push(await owner.run(command));
      }
      return Response.json({ results });
    } finally {
      await owner.dispose();
    }
  }
};
