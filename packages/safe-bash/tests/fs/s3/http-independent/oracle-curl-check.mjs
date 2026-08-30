import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { oracleSign, verifyOracleVectors } from "./oracle-signature.mjs";

const credentials = { accessKeyId: "independent-s3-review", secretAccessKey: "independent-review-secret-fixture-only" };
const requests = [];
const server = createServer((request, response) => {
  requests.push({ method: request.method, url: request.url, headers: request.headers });
  request.resume(); response.end("recorded");
});
server.listen(0, "127.0.0.1"); await once(server, "listening");
const address = server.address(); assert.ok(address && typeof address !== "string");
try {
  for (const additional of [[], ["--header", 'x-amz-copy-source-if-match: "stale"']]) {
    const args = ["-q", "--silent", "--show-error", "--noproxy", "*", "--max-time", "3", "--proto", "=http", "--aws-sigv4", "aws:amz:us-east-1:s3", "--user", `${credentials.accessKeyId}:${credentials.secretAccessKey}`, "--request", "PUT", "--header", "x-amz-copy-source: /bucket/source", ...additional, `http://127.0.0.1:${address.port}/bucket/target`];
    const child = spawn("/usr/bin/curl", args, { stdio: ["ignore", "pipe", "pipe"], env: { PATH: "/usr/bin:/bin" } });
    child.stdout.resume(); child.stderr.resume();
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
    try { const [status] = await once(child, "exit"); assert.equal(status, 0); } finally { clearTimeout(timer); }
  }
  const checks = requests.map(request => {
    const authorization = request.headers.authorization;
    const names = /SignedHeaders=([^,]+)/.exec(authorization)[1].split(";");
    const headers = Object.fromEntries(names.map(name => [name, request.headers[name]]));
    const calculated = oracleSign({ method: request.method, path: request.url, headers, date: request.headers["x-amz-date"], credentials, includePayloadHeader: names.includes("x-amz-content-sha256") });
    return { ...request, signedNames: names, expectedSortedNames: [...names].sort(), namesOrdered: names.join(";") === [...names].sort().join(";"), validSignature: authorization.endsWith("Signature=" + calculated.signature) };
  });
  writeFileSync(process.argv[2], JSON.stringify({ curl: execFileSync("/usr/bin/curl", ["--version"], { encoding: "utf8" }), binarySha256: createHash("sha256").update(readFileSync("/usr/bin/curl")).digest("hex"), oracleVectors: verifyOracleVectors(), checks }, null, 2));
  console.log(JSON.stringify(checks.map(check => ({ signedNames: check.signedNames, namesOrdered: check.namesOrdered, validSignature: check.validSignature })), null, 2));
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
