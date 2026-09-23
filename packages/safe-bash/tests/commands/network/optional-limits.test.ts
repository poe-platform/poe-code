import { Shell } from "../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { networkCommands, createWgetCommand } from "../../../src/commands/network/index.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArguments } from "../../../src/commands/network/args.js";
import { limitsFor } from "../../../src/commands/network/shared.js";
import { defaultNetworkLimits, type NetworkLimits } from "../../../src/commands/network/types.js";
import { run, server } from "./helpers.js";
import { toByteSource } from "../../../src/contracts/index.js";

test("network quotas are omitted independently", () => {
  for (const value of Object.values(limitsFor())) assert.equal(value, Infinity);
  for (const key of Object.keys(defaultNetworkLimits) as (keyof NetworkLimits)[]) {
    const limits = limitsFor({ [key]: 3 });
    for (const other of Object.keys(limits) as (keyof NetworkLimits)[]) {
      assert.equal(limits[other], other === key ? 3 : Infinity);
    }
  }
  assert.equal(limitsFor({ maxTimeMs: 3_000_000_000 }).maxTimeMs, 3_000_000_000);
});

test("curl numeric options survive parsing without implicit ceilings", () => {
  const args = parseArguments(["--max-redirs", "100", "--retry", "20", "--max-time", "3000000",
    "--connect-timeout", "3000000", "--retry-delay", "300", "--max-filesize", "100000000", "https://offline.invalid"], limitsFor());
  assert.equal(args.maxRedirects, 100);
  assert.equal(args.retries, 20);
  assert.equal(args.maxTimeMs, 3_000_000_000);
  assert.equal(args.connectTimeoutMs, 3_000_000_000);
  assert.equal(args.retryDelayMs, 300_000);
  assert.equal(args.maxFileSize, 100_000_000);
  assert.equal(parseArguments(["--max-time", "0", "https://offline.invalid"], limitsFor()).maxTimeMs, Infinity);
  const restricted = parseArguments(["--max-time", "0", "--retry", "20", "https://offline.invalid"], limitsFor({ maxTimeMs: 12, maxRetries: 2 }));
  assert.equal(restricted.maxTimeMs, 12);
  assert.equal(restricted.retries, 2);
});

test("unlimited transfers stream beyond old byte and header caps; explicit download quota still rejects", async () => {
  let bytes = 0;
  const options = {
    authorize: () => true,
    async transport() {
      return { status: 200, statusText: "OK", headers: [["X-Large", "a".repeat(70_000)]] as const,
        body: (async function* () { const chunk = new Uint8Array(1024 * 1024); for (let i = 0; i < 65; i++) yield chunk; })(),
        async dispose() {} };
    },
  };
  const result = await run(["https://offline.invalid"], { options, stdout: { async write(chunk) { bytes += chunk.length; } } });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.equal(bytes, 65 * 1024 * 1024);
  const restricted = await run(["https://offline.invalid"], { options: { ...options, limits: { maxDownloadBytes: 1 } } });
  assert.equal(restricted.exitCode, 63);
});

test("omitted URL and redirect quotas reach transport", async () => {
  let calls = 0;
  const result = await run(["-L", ...Array<string>(33).fill("https://offline.invalid")], { options: {
    authorize: () => true,
    async transport() {
      calls++;
      return { status: calls <= 11 ? 302 : 200, statusText: "OK",
        headers: calls <= 11 ? [["Location", "https://offline.invalid/next"]] : [],
        body: toByteSource(""), async dispose() {} };
    },
  } });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.equal(calls, 44);
});

test("omitted buffer quota supports stdin query and VFS header operands", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/headers", new TextEncoder().encode("X-Test: yes\n"));
  const result = await run(["-G", "--data-binary", "@-", "-H", "@headers", "https://offline.invalid"], {
    fs, stdin: "query", options: { authorize: () => true, async transport(request) {
      assert.ok(request.url.endsWith("?query"));
      assert.ok(request.headers.some(([key, value]) => key === "X-Test" && value === "yes"));
      return { status: 200, statusText: "OK", headers: [], body: toByteSource(""), async dispose() {} };
    } },
  });
  assert.equal(result.exitCode, 0, result.stderr.toString());
});

test("long and omitted deadlines do not overflow host timers", async context => {
  const { scheduleNetworkDeadline } = await import("../../../src/commands/network/deadline.js");
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let now = 0;
  context.mock.method(performance, "now", () => now);
  let expired = false;
  const cancel = scheduleNetworkDeadline(3_000_000_000, () => { expired = true; });
  now = 2_147_483_647;
  context.mock.timers.tick(now);
  assert.equal(expired, false);
  now = 3_000_000_000;
  context.mock.timers.tick(now - 2_147_483_647);
  assert.equal(expired, true);
  cancel();
  const timer = context.mock.method(globalThis, "setTimeout");
  scheduleNetworkDeadline(Infinity, () => assert.fail("omitted deadline expired"))();
  assert.equal(timer.mock.callCount(), 0);
});

test("wget zero timeout and unlimited tries reach transport in SDK and shell", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  for (const mode of ["sdk", "shell"] as const) {
    const fs = new MemoryFileSystem();
    let calls = 0;
    const options = { authorize: () => true, async transport() {
      calls++;
      if (calls < 8) throw Object.assign(new Error("retry"), { code: "ETIMEDOUT" });
      return { status: 200, statusText: "OK", headers: [], body: toByteSource("done"), async dispose() {} };
    } };
    const shell = new Shell({ fs }).use(networkCommands(options));
    let result;
    if (mode === "shell") result = shell.exec("wget -q -O - --timeout=0 --tries=0 https://offline.invalid");
    else result = createWgetCommand(options).execute({ command: "wget", args: ["-q", "-O", "-", "--timeout=0", "--tries=0", "https://offline.invalid"],
      cwd: "/", env: {}, fs, stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} }, signal: new AbortController().signal });
    let finished = false;
    void Promise.resolve(result).finally(() => { finished = true; });
    for (let i = 0; i < 100 && !finished; i++) {
      await new Promise<void>(resolve => setImmediate(resolve));
      context.mock.timers.tick(1_000_000);
    }
    assert.equal((await result).exitCode, 0);
    assert.equal(calls, 8);
    await shell.dispose();
  }
});


test("Node transport accepts large response headers and long connection timeout without truncation", async () => {
  const endpoint = await server((_request, response) => {
    response.setHeader("X-Large", "a".repeat(70_000));
    response.end("done");
    return true;
  });
  try {
    const result = await run(["--connect-timeout", "3000000", endpoint.origin]);
    assert.equal(result.exitCode, 0, result.stderr.toString());
    assert.equal(result.stdout.toString(), "done");
    const restricted = await run([endpoint.origin], { options: { limits: { maxHeaderBytes: 1024 } } });
    assert.notEqual(restricted.exitCode, 0);
  } finally { await endpoint.close(); }
});
