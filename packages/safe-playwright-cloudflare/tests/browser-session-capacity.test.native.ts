import { createServer } from "node:http";
import { once } from "node:events";
import { expect, test } from "vitest";
import { Miniflare } from "miniflare";
import { buildNativeFixture } from "./browser-native-fixture.js";

test("native named sessions preserve tabs and cookies after capacity rejection", async () => {
  const script = await buildNativeFixture(
    new URL("./browser-session-capacity.test.worker.ts", import.meta.url)
  );
  let uploadedBytes = 0;
  let uploads = 0;
  const server = createServer((request, response) => {
    if (request.url === "/upload-body") {
      request.on("data", (chunk: Buffer) => {
        uploadedBytes += chunk.byteLength;
      });
      request.on("end", () => {
        uploads++;
        response.writeHead(204).end();
      });
      return;
    }
    response.setHeader("content-type", "text/html");
    if (request.url === "/set-cookies")
      response.setHeader("set-cookie", [
        "session=first; Path=/; HttpOnly; SameSite=Lax",
        "theme=dark; Path=/; SameSite=Lax"
      ]);
    if (request.url === "/upload-test") {
      response.end(`<button onclick="upload()">Start uploads</button><script>
        async function upload() {
          let completed = 0;
          let capped = false;
          const body = new Uint8Array(2 * 1024 * 1024).fill(65);
          try { for (; completed < 33; completed++) await fetch('/upload-body', { method: 'POST', body }); }
          catch { capped = true; }
          finally { document.body.innerHTML = '<p>Uploads finished: ' + completed + '; capped: ' + capped + '</p>'; }
        }
      </script>`);
      return;
    }
    response.end(
      `<p>${request.url === "/cookies" ? (request.headers.cookie ?? "No cookies") : "Cookies saved"}</p>`
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing origin");
  const worker = new Miniflare({
    modules: true,
    script,
    compatibilityDate: "2026-07-08",
    compatibilityFlags: ["nodejs_compat"],
    browserRendering: { binding: "BROWSER" },
    durableObjects: { SESSIONS: "CapacitySessions" }
  });
  try {
    await worker.ready;
    const response = await worker.dispatchFetch("http://fixture/capacity", {
      method: "POST",
      body: `http://127.0.0.1:${address.port}`
    });
    const report = (await response.json()) as {
      results: {
        exitCode: number;
        stdout: string;
        stderr: string;
        requests: unknown[];
        sessions: { sessionId: string }[];
      }[];
    };
    expect(response.status).toBe(200);
    expect(
      report.results.map((result) => result.exitCode),
      JSON.stringify(report)
    ).toEqual([0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(
      report.results.filter((result) => result.exitCode === 0).map((result) => result.stderr)
    ).toEqual(Array(15).fill(""));
    expect(report.results[2]!.stderr).toContain("session capacity exceeded");
    expect(report.results[2]!.requests).toEqual([]);
    expect(report.results[3]!.stdout).toContain("/set-cookies)");
    expect(report.results[4]!.stdout).toContain("session=first");
    expect(report.results[4]!.stdout).toContain("theme=dark");
    expect(report.results[5]!.stdout).toContain("No cookies");
    expect(report.results.slice(1, 6).map((result) => result.sessions.length)).toEqual([
      2, 2, 2, 2, 2
    ]);
    const owned = report.results[1]!.sessions.map((session) => session.sessionId).sort();
    expect(owned).toContain(report.results[0]!.sessions[0]!.sessionId);
    for (const result of report.results.slice(2, 6)) {
      expect(result.sessions.map((session) => session.sessionId).sort()).toEqual(owned);
    }
    expect(report.results[7]!.stdout).toContain("(no browsers)");
    expect(report.results[6]!.sessions).toEqual([]);
    expect(report.results.slice(8, 10).map((result) => result.sessions.length)).toEqual([1, 1]);
    expect(report.results[10]!.sessions).toEqual([]);
    expect(report.results[14]!.stdout).toContain("Uploads finished: 33; capped: false");
    expect(uploads).toBe(33);
    expect(uploadedBytes).toBe(66 * 1024 * 1024);
    expect(report.results[15]!.sessions).toEqual([]);
  } finally {
    try {
      await worker.dispose();
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
});
