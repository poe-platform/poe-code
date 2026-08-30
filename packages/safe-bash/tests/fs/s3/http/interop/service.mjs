import assert from "node:assert/strict";
import { execFile, execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { referenceSignature, verifyOfficialVectors } from "./reference-signature.mjs";

export const lock = JSON.parse(readFileSync(new URL("./service.lock.json", import.meta.url)));
export const credentials = { accessKeyId: "safe-bash-synthetic", secretAccessKey: "safe-bash-synthetic-secret-not-for-real-use" };
export const bucket = "safe-bash-interop";
const execute = promisify(execFile);
export const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
export const sha256 = data => createHash("sha256").update(data).digest("hex");

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise(resolve => server.close(resolve));
  return address.port;
}

export async function withService(binaryPath, operation) {
  assert.equal(process.platform + "-" + process.arch, lock.platform);
  const binary = resolve(binaryPath);
  const bytes = readFileSync(binary);
  assert.equal(bytes.byteLength, lock.size);
  assert.equal(sha256(bytes), lock.sha256);
  const output = mkdtempSync("/tmp/safe-bash-s3-service-");
  save(join(output, "reference-vectors.json"), verifyOfficialVectors());
  save(join(output, "inputs.json"), readdirSync(new URL("./", import.meta.url)).filter(name => /\.(mjs|mts|json)$/.test(name)).sort()
    .map(name => { const content = readFileSync(new URL(name, import.meta.url)); return { name, sha256: sha256(content), base64: content.toString("base64") }; }));
  const home = join(output, "home"), data = join(output, "data");
  mkdirSync(home); mkdirSync(data);
  const environment = { HOME: home, PATH: "/usr/bin:/bin", MINIO_ROOT_USER: credentials.accessKeyId,
    MINIO_ROOT_PASSWORD: credentials.secretAccessKey, MINIO_BROWSER: "off", MINIO_UPDATE: "off", MINIO_CALLHOME_ENABLE: "off" };
  const version = execFileSync(binary, ["--version"], { env: environment }).toString();
  assert.ok(version.includes(lock.release) && version.includes(lock.sourceCommit));
  const port = await freePort(), consolePort = await freePort();
  const endpoint = `http://127.0.0.1:${port}`;
  const args = ["server", "--address", `127.0.0.1:${port}`, "--console-address", `127.0.0.1:${consolePort}`, data];
  const service = spawn(binary, args, { env: environment, stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(service, "exit");
  let stdout = "", stderr = "";
  service.stdout.on("data", chunk => { stdout += chunk; });
  service.stderr.on("data", chunk => { stderr += chunk; });
  const requests = [];
  let sequence = 0;
  const wire = async (method, path, { headers = {}, body, unsigned = false, secret = credentials.secretAccessKey, signer = "reference" } = {}) => {
    assert.ok(path.startsWith("/") && !path.startsWith("//"));
    const url = new URL(path, endpoint);
    assert.equal(url.origin, endpoint);
    const prefix = join(output, `wire-${++sequence}`);
    const args = ["-q", "--silent", "--show-error", "--verbose", "--path-as-is", "--noproxy", "*", "--proto", "=http", "--max-time", "15",
      "--dump-header", prefix + ".headers", "--output", prefix + ".body", "--write-out", "%{http_code}"];
    if (method === "HEAD") args.push("--head");
    else args.push("--request", method);
    let requestHeaders = headers;
    if (!unsigned && signer === "curl") args.push("--aws-sigv4", "aws:amz:us-east-1:s3", "--user", `${credentials.accessKeyId}:${secret}`);
    if (!unsigned && signer === "reference") requestHeaders = referenceSignature({ method, host: url.host, path, headers, body,
      accessKeyId: credentials.accessKeyId, secretAccessKey: secret }).headers;
    for (const [name, value] of Object.entries(requestHeaders)) args.push("--header", `${name}: ${value}`);
    if (body !== undefined) { writeFileSync(prefix + ".request", body); args.push("--data-binary", "@" + prefix + ".request"); }
    args.push(endpoint + path);
    const result = await execute("/usr/bin/curl", args, { env: { HOME: home, PATH: "/usr/bin:/bin" }, maxBuffer: 4 * 1024 * 1024 });
    writeFileSync(prefix + ".trace", result.stderr);
    const rawHeaders = readFileSync(prefix + ".headers", "utf8");
    const responseHeaders = Object.fromEntries(rawHeaders.split(/\r?\n/).filter(line => line.includes(":"))
      .map(line => [line.slice(0, line.indexOf(":")).toLowerCase(), line.slice(line.indexOf(":") + 1).trim()]));
    const content = readFileSync(prefix + ".body");
    const response = { sequence, method, path, inputHeaders: headers, signed: !unsigned, signer, status: Number(result.stdout), headers: responseHeaders,
      bodyBase64: content.toString("base64"), bodyText: content.toString("utf8") };
    requests.push(response);
    save(join(output, "requests.json"), requests);
    return { ...response, body: content };
  };
  save(join(output, "launch.json"), { binary, lock, version, args, environment, pid: service.pid, endpoint,
    invocation: process.argv,
    node: process.version, platform: process.platform + "-" + process.arch,
    curl: execFileSync("/usr/bin/curl", ["--version"]).toString() });
  console.log(output);
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (service.exitCode !== null) throw new Error("MinIO exited before readiness");
      try { ready = (await fetch(endpoint + "/minio/health/live", { signal: AbortSignal.timeout(500) })).ok; } catch {}
      if (ready) break;
      await delay(100);
    }
    assert.ok(ready, "MinIO readiness deadline");
    const listeners = execFileSync("/usr/sbin/lsof", ["-nP", "-a", "-p", String(service.pid), "-iTCP", "-sTCP:LISTEN", "-Fn"]).toString();
    writeFileSync(join(output, "listeners.txt"), listeners);
    const addresses = listeners.split("\n").filter(line => line.startsWith("n"));
    assert.ok(addresses.length > 0 && addresses.every(line => line.startsWith("n127.0.0.1:") || line.startsWith("n[::1]:")));
    const created = await wire("PUT", "/" + bucket);
    assert.equal(created.status, 200, created.bodyText);
    await operation({ output, endpoint, wire, requests, bucket, credentials });
  } finally {
    service.kill("SIGTERM");
    const killed = setTimeout(() => service.kill("SIGKILL"), 5000);
    killed.unref();
    const [code, signal] = await exited;
    clearTimeout(killed);
    writeFileSync(join(output, "service.stdout"), stdout);
    writeFileSync(join(output, "service.stderr"), stderr);
    rmSync(data, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
    save(join(output, "shutdown.json"), { pid: service.pid, code, signal, ownedDataRemoved: true, ownedHomeRemoved: true, time: new Date().toISOString() });
  }
  return output;
}
