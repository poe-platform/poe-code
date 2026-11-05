import { build } from "esbuild";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const { outputFiles: [bundle] } = await build({
  entryPoints: [fileURLToPath(new URL("../shell.mjs", import.meta.url))],
  format: "esm", platform: "browser", bundle: true, write: false,
});
const out = fileURLToPath(new URL("../../../../out/", import.meta.url));
await mkdir(out, { recursive: true });
const profile = await mkdtemp(join(out, "safe-bash-browser-"));
const { promise, resolve, reject } = Promise.withResolvers();
const server = createServer(async (req, res) => {
  if (req.url === "/") {
    res.setHeader("Content-Type", "text/html");
    res.end(`<script type="module">
      try { await (await import("/test.js")).default.test(); await fetch("/pass", {method:"POST"}); }
      catch (error) { await fetch("/fail", {method:"POST", body:String(error.stack ?? error)}); }
    </script>`);
  } else if (req.url === "/test.js") {
    res.setHeader("Content-Type", "application/javascript");
    res.end(bundle.contents);
  } else if (req.url === "/safe_bash_rust.wasm") {
    res.setHeader("Content-Type", "application/wasm");
    createReadStream(new URL("../../dist/safe_bash_rust.wasm", import.meta.url)).on("error", reject).pipe(res);
  } else if (req.method === "POST" && ["/pass", "/fail"].includes(req.url)) {
    let detail = "";
    for await (const part of req) detail += part;
    res.end();
    if (req.url === "/pass") resolve(); else reject(new Error(detail));
  } else { res.writeHead(404).end(); }
});
let browser;
const timeout = setTimeout(() => reject(new Error("Chromium test timed out")), 30_000);
try {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  browser = spawn(process.env.CHROME_BIN ?? "chromium", [
    "--headless", "--disable-gpu", "--disable-dev-shm-usage", "--no-first-run", "--disable-background-networking",
    "--user-data-dir=" + profile, "http://127.0.0.1:" + server.address().port,
  ], { stdio: ["ignore", "ignore", "inherit"] });
  browser.on("error", reject);
  browser.on("exit", (code, signal) => reject(new Error("Chromium exited: " + (signal ?? code))));
  await promise;
} finally {
  clearTimeout(timeout);
  if (browser?.pid && browser.exitCode === null && browser.signalCode === null) {
    const closed = once(browser, "close");
    browser.kill();
    await closed;
  }
  server.closeAllConnections();
  server.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 3 });
}
