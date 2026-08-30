import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const resolvedEntry = import.meta.resolve("virtual-bash");
assert.equal(resolvedEntry, pathToFileURL(resolve("dist/index.js")).href);
const { Shell, createMemoryFileSystem, agentCommands, networkCommands, createAgentCommands } = await import("virtual-bash");
const directBuild = await import(pathToFileURL(resolve("dist/index.js")).href);
assert.equal(Shell, directBuild.Shell);
assert.equal(networkCommands, directBuild.networkCommands);
assert(!createAgentCommands().some((command) => command.name === "curl"));
const independentPath = "tests/commands/network-stress/final-verification/independent-native-frozen.json";
const independentBytes = await readFile(independentPath);
const independent = JSON.parse(independentBytes);
const stdoutOracle = independent.observations.find((row) => row.id === "two-retries-stdout");
const fileOracle = independent.observations.find((row) => row.id === "two-retries-file-headers-post");
const redirectOracle = independent.observations.find((row) => row.id === "two-retries-shell-redirection");
assert.equal(Buffer.from(stdoutOracle.stdout, "base64").toString(), "retryretryrecovered:9:200:0");
assert.equal(stdoutOracle.traces.length, 3);
const finalBody = Buffer.from(fileOracle.files["result.bin"], "base64").toString().split("\r\n\r\n").at(-1);
assert.equal(finalBody, "recovered");
const retainedBody = Buffer.from(redirectOracle.files["result.bin"], "base64");
assert.equal(retainedBody.toString(), "retryretryrecovered");
const payload = Buffer.from(stdoutOracle.files["payload.bin"], "base64");
const sockets = new Set();
const attempts = new Map();
const requests = [];
const authorized = [];
const rows = [];
const fixtureErrors = [];
const server = createServer((request, response) => {
  void (async () => {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      assert(size <= 1024);
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);
    requests.push({ method: request.method, path: request.url, body: body.toString("base64") });
    const count = (attempts.get(request.url) ?? 0) + 1;
    attempts.set(request.url, count);
    let bytes;
    let status = 200;
    if (request.url === "/download") bytes = payload;
    else if (request.url === "/upload") {
      assert.equal(request.method, "PUT");
      assert.deepEqual(body, payload);
      bytes = body;
    } else {
      assert(["/retry-stdout", "/retry-file", "/retry-redirection"].includes(request.url));
      assert(count <= 3);
      status = count < 3 ? 503 : 200;
      bytes = Buffer.from(count < 3 ? "retry" : "recovered");
    }
    response.sendDate = false;
    response.writeHead(status, { "Content-Length": bytes.length, Connection: "close", "Retry-After": "0" });
    response.end(bytes);
  })().catch((error) => { fixtureErrors.push(String(error)); response.destroy(error); });
});
server.on("connection", (socket) => {
  sockets.add(socket);
  socket.once("close", () => sockets.delete(socket));
});
server.on("error", (error) => fixtureErrors.push(String(error)));
const controller = new AbortController();
const watchdog = setTimeout(() => controller.abort(new Error("Built-package smoke deadline")), 15000);
let shell;
let failure;
let cleanup;
try {
  await new Promise((resolveReady, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolveReady(); });
  });
  const address = server.address();
  assert(address && typeof address === "object" && address.address === "127.0.0.1");
  const origin = `http://127.0.0.1:${address.port}`;
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/payload.bin", payload);
  await fs.writeFile("/work/result.bin", Buffer.from("old bytes"));
  shell = new Shell({ fs, cwd: "/work", limits: { maxOutputBytes: 1024 * 1024 } })
    .use(agentCommands())
    .use(networkCommands({
      authorize(request) {
        const allowed = new URL(request.url).origin === origin;
        authorized.push({ url: request.url, attempt: request.attempt, allowed });
        return allowed;
      },
      limits: { maxTimeMs: 3000, maxDownloadBytes: 1024, maxUploadBytes: 1024 },
    }));
  async function execute(id, command, expected, path, expectedFile) {
    const result = await shell.exec(command, { signal: controller.signal });
    const stdout = Buffer.from(result.stdoutBytes);
    const file = path ? Buffer.from(await fs.readFile(path, { maxBytes: 1024 })) : undefined;
    const row = { id, command, exitCode: result.exitCode, stdout: stdout.toString("base64"), stdoutText: stdout.toString(), stderr: Buffer.from(result.stderr).toString(), filePath: path ?? null, file: file?.toString("base64") ?? null, fileText: file?.toString() ?? null };
    rows.push(row);
    assert.equal(result.exitCode, 0);
    assert.deepEqual(stdout, Buffer.from(expected));
    if (path) assert.deepEqual(file, Buffer.from(expectedFile));
    if (id === "retry-managed-file") assert.equal((row.stderr.match(/curl: \(22\)/g) ?? []).length, 2);
    else assert.equal(row.stderr, "");
    row.status = "passed";
  }
  await execute("ordinary-download", `curl -sS -o download.bin ${origin}/download`, "", "/work/download.bin", payload);
  await execute("binary-vfs-upload", `curl -sS -T payload.bin ${origin}/upload`, payload);
  await execute("retry-stdout", `curl -sS --retry 2 --retry-delay 0.001 -w ':%{num_retries}' ${origin}/retry-stdout`, Buffer.concat([retainedBody, Buffer.from(":2")]));
  await execute("retry-managed-file", `curl -sS --retry 2 --retry-delay 0.001 --fail-with-body -o result.bin ${origin}/retry-file`, "", "/work/result.bin", finalBody);
  await execute("retry-shell-redirection", `curl -sS --retry 2 --retry-delay 0.001 ${origin}/retry-redirection > redirected.bin`, "", "/work/redirected.bin", retainedBody);
  assert.deepEqual([...attempts], [["/download", 1], ["/upload", 1], ["/retry-stdout", 3], ["/retry-file", 3], ["/retry-redirection", 3]]);
  assert.equal(authorized.length, 11);
  assert(authorized.every((request) => request.allowed));
  assert.deepEqual(fixtureErrors, []);
} catch (error) {
  failure = error.stack ?? String(error);
} finally {
  clearTimeout(watchdog);
  controller.abort();
  try {
    await shell?.dispose();
    let cleanupTimer;
    try {
      await Promise.race([
        (async () => {
          const closed = [...sockets].map((socket) => new Promise((resolveClosed) => socket.once("close", resolveClosed)));
          const stopped = server.listening ? new Promise((resolveStopped, reject) => server.close((error) => error ? reject(error) : resolveStopped())) : Promise.resolve();
          server.closeAllConnections();
          for (const socket of sockets) socket.destroy();
          await Promise.all([...closed, stopped]);
        })(),
        new Promise((_, reject) => { cleanupTimer = setTimeout(() => reject(new Error("Smoke cleanup deadline")), 2000); }),
      ]);
    } finally { clearTimeout(cleanupTimer); }
    assert.equal(server.listening, false);
    assert.equal(sockets.size, 0);
    cleanup = { listening: server.listening, sockets: sockets.size, shellDisposed: true, watchdogCleared: true };
  } catch (error) { failure = `${failure ?? ""}\ncleanup: ${error.stack ?? error}`; }
}
console.log(JSON.stringify({ harnessSha256: createHash("sha256").update(await readFile(new URL(import.meta.url))).digest("hex"), resolvedEntry, entrySha256: createHash("sha256").update(await readFile(new URL(resolvedEntry))).digest("hex"), expectationSource: { path: independentPath, sha256: createHash("sha256").update(independentBytes).digest("hex") }, rows, requests, authorized, fixtureErrors, cleanup, failure: failure ?? null, total: 5, passed: rows.filter((row) => row.status === "passed").length, failed: failure ? 1 : 0 }));
process.exitCode = failure ? 1 : 0;
