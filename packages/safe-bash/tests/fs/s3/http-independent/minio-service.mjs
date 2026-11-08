import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request as nativeRequest } from "node:http";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { oracleSign, verifyOracleVectors } from "./oracle-signature.mjs";

const directory = resolve(process.argv[2]), binary = resolve(process.argv[3]);
const setup = JSON.parse(readFileSync(join(directory, "prepare.json"), "utf8"));
assert.ok(setup.phases.every(phase => phase.status === 0));
const oracleVectors = verifyOracleVectors();
const lock = setup.serviceLock;
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
assert.equal(sha(readFileSync(binary)), lock.sha256);
const output = join(directory, "independent-minio"); mkdirSync(output);
const home = join(output, "home"), data = join(output, "data"), nativeFiles = join(output, "native");
for (const path of [home, data, nativeFiles]) mkdirSync(path, { mode: 0o700 });
const credentials = { accessKeyId: "independent-s3-review", secretAccessKey: "independent-review-secret-fixture-only" };
const environment = { HOME: home, PATH: "/usr/bin:/bin", MINIO_ROOT_USER: credentials.accessKeyId,
  MINIO_ROOT_PASSWORD: credentials.secretAccessKey, MINIO_BROWSER: "off", MINIO_UPDATE: "off", MINIO_CALLHOME_ENABLE: "off" };
async function freePort() {
  const server = createServer(); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  await new Promise(resolve => server.close(resolve)); return address.port;
}
const port = await freePort(), consolePort = await freePort(), endpoint = `http://127.0.0.1:${port}`;
const args = ["server", "--address", `127.0.0.1:${port}`, "--console-address", `127.0.0.1:${consolePort}`, data];
const version = execFileSync(binary, ["--version"], { env: environment, encoding: "utf8", timeout: 5000 });
assert.ok(version.includes(lock.release) && version.includes(lock.sourceCommit));
const service = spawn(binary, args, { env: environment, stdio: ["ignore", "pipe", "pipe"] });
const exited = once(service, "exit"); let serviceOut = "", serviceErr = "";
service.stdout.on("data", chunk => { serviceOut += chunk; }); service.stderr.on("data", chunk => { serviceErr += chunk; });
const killService = () => service.kill("SIGTERM");
process.once("SIGTERM", killService); process.once("SIGINT", killService);
const deadline = setTimeout(killService, 90000);
const requests = [], guards = [], trace = [];
const bucket = "independent-s3-http";
const report = { revision: setup.revision, overlay: setup.overlay, sourceHashes: setup.sourceHashes, packageSha256: setup.packageSha256,
  oracle: { signer: "independent AWS-vector-validated HMAC; native curl sends exact signed headers, no product signer", vectors: oracleVectors },
  node: process.version, curl: execFileSync("/usr/bin/curl", ["--version"], { encoding: "utf8" }), lock, binarySha256: sha(readFileSync(binary)),
  launch: { pid: service.pid, args, environment, version, endpoint }, requests, guards, trace };
const save = () => writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2));
function wire(method, path, options = {}) {
  assert.ok(path.startsWith(`/${bucket}`) && !/[\r\n]/.test(path));
  const files = join(nativeFiles, String(requests.length + 1));
  const args = ["-q", "--silent", "--show-error", "--path-as-is", "--noproxy", "*", "--proto", "=http", "--max-time", "10",
    "--dump-header", files + ".headers", "--output", files + ".body", "--write-out", "%{http_code}"];
  if (method === "HEAD") args.push("--head"); else args.push("--request", method);
  const signedHeaders = options.unsigned ? options.headers ?? {} : oracleSign({ method, path, headers: { host: `127.0.0.1:${port}`, ...options.headers }, body: options.body, credentials: { ...credentials, secretAccessKey: options.secret ?? credentials.secretAccessKey } }).headers;
  for (const [name, value] of Object.entries(signedHeaders)) args.push("--header", `${name}: ${value}`);
  if (options.body !== undefined) { writeFileSync(files + ".input", options.body); args.push("--data-binary", "@" + files + ".input"); }
  args.push(endpoint + path);
  const status = Number(execFileSync("/usr/bin/curl", args, { env: { HOME: home, PATH: "/usr/bin:/bin" }, encoding: "utf8", timeout: 12000, maxBuffer: 4 * 1024 * 1024 }));
  const bytes = readFileSync(files + ".body"), headers = Object.fromEntries(readFileSync(files + ".headers", "utf8").split(/\r?\n/).filter(line => line.includes(":"))
    .map(line => [line.slice(0, line.indexOf(":")).toLowerCase(), line.slice(line.indexOf(":") + 1).trim()]));
  const row = { method, path, headers: options.headers ?? {}, signedHeaders, input: options.body === undefined ? undefined : Buffer.from(options.body).toString("base64"), status, responseHeaders: headers, bodyBase64: bytes.toString("base64"), signed: !options.unsigned, badSecret: options.secret !== undefined };
  requests.push(row); save(); return { ...row, bytes };
}
const pathFor = key => `/${bucket}/` + encodeURIComponent(key).replace(/%2F/g, "/");
const put = (key, body) => { const result = wire("PUT", pathFor(key), { body }); assert.equal(result.status, 200, result.bytes.toString()); return result.responseHeaders.etag; };
const read = key => wire("GET", pathFor(key));
const sourceBytes = Buffer.from([0, 255, 127, 128, 10, 13, 42, 0]), targetBytes = Buffer.from("ORIGINAL"), newBytes = Buffer.from([78, 0, 69, 255, 87]);
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (service.exitCode !== null) throw new Error("MinIO exited before readiness: " + serviceErr);
    try { ready = (await fetch(endpoint + "/minio/health/live", { signal: AbortSignal.timeout(300) })).ok; } catch {}
    if (ready) break; await delay(100);
  }
  assert.ok(ready, "independent MinIO readiness deadline");
  const listeners = execFileSync("/usr/sbin/lsof", ["-nP", "-a", "-p", String(service.pid), "-iTCP", "-sTCP:LISTEN", "-Fn"], { encoding: "utf8" });
  const addresses = listeners.split("\n").filter(line => line.startsWith("n"));
  assert.ok(addresses.length > 0 && addresses.every(line => line.startsWith("n127.0.0.1:") || line.startsWith("n[::1]:"))); report.listeners = listeners;
  assert.equal(wire("PUT", `/${bucket}`).status, 200);
  const sourceTag = put("guard-source", sourceBytes);
  function probe(id, method, key, options, expectedStatus, expectedBytes) {
    const response = wire(method, pathFor(key), options), after = read(key), source = read("guard-source");
    const passed = response.status === expectedStatus && after.status === (expectedBytes === undefined ? 404 : 200)
      && (expectedBytes === undefined || after.bytes.equals(expectedBytes)) && source.status === 200 && source.bytes.equals(sourceBytes);
    guards.push({ id, expectedStatus, actualStatus: response.status, expectedBytes: expectedBytes?.toString("base64"), after: { status: after.status, bytes: after.bodyBase64 }, sourcePreserved: source.bytes.equals(sourceBytes), passed }); save();
  }
  probe("auth-unsigned", "GET", "guard-source", { unsigned: true }, 403, sourceBytes);
  probe("auth-wrong-signature", "PUT", "guard-source", { secret: "wrong-secret", body: newBytes }, 403, sourceBytes);
  let tag = put("put-target", targetBytes);
  probe("put-stale", "PUT", "put-target", { headers: { "If-Match": '"stale"' }, body: newBytes }, 412, targetBytes);
  probe("put-matching", "PUT", "put-target", { headers: { "If-Match": tag }, body: newBytes }, 200, newBytes);
  probe("put-missing-match", "PUT", "put-missing", { headers: { "If-Match": tag }, body: newBytes }, 404, undefined);
  probe("put-exclusive-existing", "PUT", "put-target", { headers: { "If-None-Match": "*" }, body: newBytes }, 412, newBytes);
  probe("put-exclusive-new", "PUT", "put-new", { headers: { "If-None-Match": "*" }, body: newBytes }, 200, newBytes);
  const copyHeaders = { "x-amz-copy-source": pathFor("guard-source") };
  put("copy-target", targetBytes);
  probe("copy-source-stale", "PUT", "copy-target", { headers: { ...copyHeaders, "x-amz-copy-source-if-match": '"stale"' } }, 412, targetBytes);
  probe("copy-source-matching", "PUT", "copy-target", { headers: { ...copyHeaders, "x-amz-copy-source-if-match": sourceTag } }, 200, sourceBytes);
  tag = put("copy-target", targetBytes);
  probe("copy-destination-stale", "PUT", "copy-target", { headers: { ...copyHeaders, "If-Match": '"stale"' } }, 412, targetBytes);
  put("copy-target", targetBytes);
  probe("copy-destination-matching", "PUT", "copy-target", { headers: { ...copyHeaders, "If-Match": tag } }, 200, sourceBytes);
  probe("copy-destination-missing", "PUT", "copy-missing", { headers: { ...copyHeaders, "If-Match": tag } }, 412, undefined);
  put("copy-target", targetBytes);
  probe("copy-exclusive-existing", "PUT", "copy-target", { headers: { ...copyHeaders, "If-None-Match": "*" } }, 412, targetBytes);
  probe("copy-exclusive-new", "PUT", "copy-new", { headers: { ...copyHeaders, "If-None-Match": "*" } }, 200, sourceBytes);
  tag = put("delete-target", targetBytes);
  probe("delete-stale", "DELETE", "delete-target", { headers: { "If-Match": '"stale"' } }, 412, targetBytes);
  put("delete-target", targetBytes);
  probe("delete-matching", "DELETE", "delete-target", { headers: { "If-Match": tag } }, 204, undefined);
  probe("delete-missing", "DELETE", "delete-missing", { headers: { "If-Match": tag } }, 204, undefined);
  const all = prefix => guards.filter(row => row.id.startsWith(prefix)).every(row => row.passed);
  report.profile = { authentication: all("auth-"), conditionalPut: all("put-"), nativeConditionalCopy: all("copy-"), conditionalDelete: all("delete-"), passed: guards.filter(row => row.passed).length, total: guards.length };
  report.nativeStrictStatus = guards.every(row => row.passed) ? 0 : 1;
  assert.equal(report.profile.authentication, true); assert.equal(report.profile.conditionalPut, true);
  const author = await import(pathToFileURL(join(setup.consumer, "public-consumer.mjs")));
  const authorPrefix = "author-" + randomUUID();
  report.authorPublic = await author.runPublicS3Example({ endpoint, bucket, prefix: authorPrefix, credentials, region: "us-east-1", verifiedConditionalPut: true, allowInsecureHttp: true, listUrlEncoding: "form" });
  report.authorWitnesses = [];
  for (const [name, expected] of [["work/source", report.authorPublic.sourceBytes], ["work/copy", report.authorPublic.copiedBytes], ["work/existing", report.authorPublic.copiedBytes], ["work/雪 space +%", report.authorPublic.copiedBytes], ["other/target", report.authorPublic.sourceBytes], ["work/move-target", [7, 8, 9]]]) {
    const result = read(authorPrefix + "/" + name); assert.equal(result.status, 200); assert.deepEqual(result.bytes, Buffer.from(expected)); report.authorWitnesses.push({ name, bytes: result.bodyBase64, matched: true });
  }
  const independent = await import(pathToFileURL(join(setup.consumer, "public-workflow.mjs")));
  report.public = await independent.runIndependentWorkflow({ endpoint, bucket, prefix: "independent-" + randomUUID(), credentials,
    request: (options, callback) => {
      assert.equal(options.hostname, "127.0.0.1"); assert.equal(String(options.port), String(port));
      const row = { method: options.method, path: options.path, headers: options.headers }; trace.push(row);
      return nativeRequest(options, response => { row.status = response.statusCode; callback(response); });
    },
    oracle: async key => { const result = read(key); return { status: result.status, bytes: result.bytes }; },
  });
  report.paginationObserved = trace.some(row => row.path.includes("continuation-token="));
  assert.equal(report.paginationObserved, true); assert.equal(report.public.passed, report.public.total, JSON.stringify(report.public.checks.filter(row => !row.passed)));
  save();
} catch (error) { report.failure = { name: error.name, message: error.message, stack: error.stack }; save(); process.exitCode = 1; }
finally {
  clearTimeout(deadline); process.removeListener("SIGTERM", killService); process.removeListener("SIGINT", killService);
  service.kill("SIGTERM"); const forced = setTimeout(() => service.kill("SIGKILL"), 5000);
  const [status, signal] = await exited; clearTimeout(forced);
  rmSync(data, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true });
  report.shutdown = { pid: service.pid, status, signal, dataRemoved: true, homeRemoved: true, at: new Date().toISOString() };
  report.serviceStdout = serviceOut; report.serviceStderr = serviceErr; save();
}
console.log(JSON.stringify({ output, profile: report.profile, authorChecks: report.authorPublic?.checks.length, authorWitnesses: report.authorWitnesses?.length, independent: report.public && { passed: report.public.passed, total: report.public.total, workflows: report.public.workflows, witnesses: report.public.witnesses.length }, failure: report.failure, shutdown: report.shutdown }, null, 2));
