import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const base = new URL("../", import.meta.url);
const service = new URL("evidence-1D1P9B/service-zfI7Y9/", base);
const read = (name, directory = service) => readFileSync(new URL(name, directory));
const json = (name, directory = service) => JSON.parse(read(name, directory));
const hash = value => createHash("sha256").update(value).digest("hex");
const requests = json("requests.json");
const launch = json("launch.json");
const primary = json("primary-sources.json", new URL("./", import.meta.url));
const source = path => primary.sourceFiles.find(file => file.path === path).text;
const uriEncode = value => encodeURIComponent(value).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
const textOf = (xml, name) => new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml)?.[1];
const keysOf = xml => [...xml.matchAll(/<Key>([^<]*)<\/Key>/g)].map(match => decodeURIComponent(match[1]));

function signature(method, target, headers, names, scope, secret, body) {
  const split = target.indexOf("?");
  const pathname = split < 0 ? target : target.slice(0, split);
  const entries = [...new URLSearchParams(split < 0 ? "" : target.slice(split + 1))]
    .map(([name, value]) => [uriEncode(name), uriEncode(value)])
    .sort(([leftName, leftValue], [rightName, rightValue]) => {
      const left = `${leftName}=${leftValue}`, right = `${rightName}=${rightValue}`;
      return left < right ? -1 : left > right ? 1 : 0;
    });
  const query = entries.map(([name, value]) => `${name}=${value}`).join("&");
  const canonical = [method, pathname, query,
    names.map(name => `${name}:${headers[name].trim().replace(/\s+/g, " ")}\n`).join(""), names.join(";"), hash(body)].join("\n");
  let signingKey = Buffer.from(`AWS4${secret}`);
  for (const part of scope.split("/")) signingKey = createHmac("sha256", signingKey).update(part).digest();
  const calculated = createHmac("sha256", signingKey).update(`AWS4-HMAC-SHA256\n${headers["x-amz-date"]}\n${scope}\n${hash(canonical)}`).digest("hex");
  return { calculated, canonical, query };
}

test("all 606 original evidence files and original 19/20 remain unchanged", context => {
  const seal = read("SHA256SUMS", base);
  assert.equal(hash(seal), "d6e50e546649b6e2085af7a148f3b58b7daddac176bfba498eaa5c2ad8dd7a62");
  const lines = seal.toString().trimEnd().split("\n");
  assert.equal(lines.length, 606);
  for (const line of lines) {
    const [expected, path] = line.split("  ");
    assert.equal(hash(read(path, base)), expected, path);
  }
  const original = json("author-results.json");
  assert.equal(original.results.length, 20);
  assert.equal(original.results.filter(result => result.passed).length, 19);
  assert.equal(original.verifiedProductRmdirPositiveWorkflows, 0);
  const failure = original.results.find(result => !result.passed);
  assert.equal(failure.name, "typed ENOTEMPTY for /work");
  assert.match(failure.error, /\+ 'ENOTSUP'/);
  assert.match(failure.error, /- 'ENOTEMPTY'/);
  assert.equal(json("product-requests.json").filter(request => request.method === "DELETE").length, 0);
  assert.equal(launch.lock.sourceCommit, primary.sourceCommit);
  assert.equal(launch.lock.sha256, "7c3b3039b76e55a1b80935848ed83998d5e8d317374f87851f46a019ff5c0aa4");
  assert.match(launch.version, /RELEASE\.2025-09-07T16-13-09Z.*07c3a429bfed433e49018cb0f78a52145d4bedeb/);
  context.diagnostic("606 preserved files; historical service cohort still 19/20; no new service execution");
});

test("independent SigV4 audit authenticates all 68 retained wire requests", context => {
  const officialHeaders = { host: "examplebucket.s3.amazonaws.com", "x-amz-date": "20130524T000000Z", "x-amz-content-sha256": hash(Buffer.alloc(0)) };
  const officialNames = Object.keys(officialHeaders).sort();
  const officialSignature = signature("GET", "/?prefix=J&max-keys=2", officialHeaders, officialNames,
    "20130524/us-east-1/s3/aws4_request", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", Buffer.alloc(0));
  assert.equal(officialSignature.calculated, "34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7");
  assert.ok(primary.documents[1].text.includes(officialSignature.calculated));
  assert.equal(requests.length, 68);
  let correctSecret = 0, intentionalWrongSecret = 0;
  for (const row of requests) {
    const raw = read(`wire-${row.sequence}.trace`).toString();
    const outbound = raw.split(/\r?\n/).filter(line => line.startsWith("> ")).map(line => line.slice(2));
    assert.equal(outbound[0], `${row.method} ${row.path} HTTP/1.1`);
    const headers = Object.fromEntries(outbound.slice(1).filter(line => line.includes(":"))
      .map(line => [line.slice(0, line.indexOf(":")).toLowerCase(), line.slice(line.indexOf(":") + 1).trim()]));
    assert.equal(headers.host, new URL(launch.endpoint).host);
    const authorization = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/([^,]+), SignedHeaders=([^,]+), Signature=([a-f0-9]{64})$/.exec(headers.authorization);
    assert.ok(authorization);
    assert.equal(authorization[1], "safe-bash-synthetic");
    assert.equal(authorization[2], "20260827/us-east-1/s3/aws4_request");
    const names = authorization[3].split(";");
    assert.deepEqual(names, [...names].sort());
    const requestFile = new URL(`wire-${row.sequence}.request`, service);
    const body = existsSync(requestFile) ? readFileSync(requestFile) : Buffer.alloc(0);
    assert.equal(headers["x-amz-content-sha256"], hash(body));
    const trusted = signature(row.method, row.path, headers, names, authorization[2], launch.environment.MINIO_ROOT_PASSWORD, body);
    if (row.sequence === 67) {
      assert.notEqual(trusted.calculated, authorization[4]);
      const bad = signature(row.method, row.path, headers, names, authorization[2], "incorrect-synthetic-secret", body);
      assert.equal(bad.calculated, authorization[4]);
      assert.equal(row.status, 403);
      assert.equal(row.path, "/safe-bash-interop/author/delete-denied/");
      intentionalWrongSecret++;
    } else {
      assert.equal(trusted.calculated, authorization[4], `signature ${row.sequence}`);
      correctSecret++;
    }
    const responseBody = read(`wire-${row.sequence}.body`);
    assert.deepEqual(responseBody, Buffer.from(row.bodyBase64, "base64"));
    const rawHeaders = read(`wire-${row.sequence}.headers`).toString();
    assert.ok(rawHeaders.startsWith(`HTTP/1.1 ${row.status} `));
    const contentLength = /^Content-Length: (\d+)\r?$/mi.exec(rawHeaders);
    if (contentLength) assert.equal(Number(contentLength[1]), responseBody.length);
    else {
      assert.equal(row.status, 204);
      assert.equal(responseBody.length, 0);
    }
    if (row.sequence >= 18 && row.sequence <= 23) context.diagnostic(JSON.stringify({ sequence: row.sequence, canonicalQuery: trusted.query, signatureVerified: true }));
  }
  assert.equal(correctSecret, 67);
  assert.equal(intentionalWrongSecret, 1);
  context.diagnostic("67 correct-secret matches; one authenticated deliberate wrong-secret negative; official AWS LIST query vector matches");
});

test("namespace and pagination facts distinguish provider deviation from oracle error", context => {
  for (const sequence of [2, 16, 24]) {
    const row = requests[sequence - 1];
    assert.equal(row.path, "/safe-bash-interop/author/work/");
    assert.equal(row.status, 200);
    assert.equal(read(`wire-${sequence}.body`).length, 0);
  }
  for (const sequence of [3, 17, 25]) {
    const row = requests[sequence - 1];
    assert.equal(row.path, "/safe-bash-interop/author/work/file");
    assert.equal(row.status, 200);
    assert.equal(read(`wire-${sequence}.body`).toString(), "payload");
  }
  const proof = [];
  for (let sequence = 18; sequence <= 23; sequence++) {
    const row = requests[sequence - 1];
    const url = new URL(row.path, launch.endpoint);
    const query = url.searchParams;
    assert.equal(url.pathname, "/safe-bash-interop");
    assert.equal(query.get("list-type"), "2");
    assert.equal(query.get("prefix"), "author/work/");
    assert.equal(query.get("encoding-type"), "url");
    assert.equal(query.has("continuation-token"), false);
    assert.equal(query.has("start-after"), false);
    assert.equal([...query.keys()].length, new Set(query.keys()).size);
    const maxKeys = Number(query.get("max-keys"));
    const delimiter = query.get("delimiter");
    assert.equal(delimiter, sequence % 2 ? "/" : null);
    const xml = read(`wire-${sequence}.body`).toString();
    assert.equal(textOf(xml, "Prefix"), "author/work/");
    assert.equal(Number(textOf(xml, "MaxKeys")), maxKeys);
    assert.equal(textOf(xml, "IsTruncated"), "false");
    assert.equal(textOf(xml, "NextContinuationToken"), undefined);
    assert.equal(xml.includes("<CommonPrefixes>"), false);
    const keys = keysOf(xml);
    assert.deepEqual(keys, maxKeys === 1 ? ["author/work/"] : ["author/work/", "author/work/file"]);
    assert.equal(Number(textOf(xml, "KeyCount")), keys.length);
    proof.push({ sequence, maxKeys, delimiter, keys, isTruncated: false, omittedKnownChild: maxKeys === 1 });
  }
  const otherPrefix = read("wire-12.body").toString();
  assert.equal(textOf(otherPrefix, "IsTruncated"), "true");
  assert.ok(textOf(otherPrefix, "NextContinuationToken"));
  context.diagnostic(JSON.stringify({ proof, parentPrefixTruncationPositiveControl: 12, originalExpectedENOTEMPTYUnchanged: true }));
});

test("authenticated pinned source explains the MaxKeys1 shortcut without a new service run", context => {
  assert.equal(primary.sourceCommit, "07c3a429bfed433e49018cb0f78a52145d4bedeb");
  assert.equal(primary.gitTree.truncated, false);
  assert.equal(primary.sourceFiles.length, 6);
  for (const file of primary.sourceFiles) {
    assert.equal(hash(file.text), file.sha256);
    assert.equal(Buffer.byteLength(file.text), file.bytes);
    const blob = createHash("sha1").update(`blob ${file.bytes}\0`).update(file.text).digest("hex");
    assert.equal(blob, file.gitBlobSha1);
    assert.equal(blob, primary.gitTree.selectedEntries.find(entry => entry.path === file.path).sha);
    assert.equal(file.url, `https://raw.githubusercontent.com/minio/minio/${primary.sourceCommit}/${file.path}`);
  }
  for (const document of primary.documents) assert.equal(hash(document.text), document.sha256);
  const pool = source("cmd/erasure-server-pool.go");
  const start = pool.indexOf('\tif len(prefix) > 0 && maxKeys == 1 && marker == "" {');
  assert.ok(start > 0);
  const end = pool.indexOf("\n\treturn listFn(ctx, opts, maxKeys)", start);
  assert.ok(end > start);
  const shortcut = pool.slice(start, end);
  assert.match(shortcut, /z.GetObjectInfo\(ctx, bucket, prefix, ObjectOptions\{NoLock: true\}\)/);
  assert.match(shortcut, /loi.Objects = append\(loi.Objects, objInfo\)\s+return loi, nil/);
  assert.doesNotMatch(shortcut, /IsTruncated|NextMarker|delimiter|hadoop|UserAgent|listPath\(/);
  assert.match(pool, /\(loi ListObjectsInfo, err error\)/);
  assert.match(pool, /IsTruncated:\s+loi.IsTruncated/);
  assert.match(pool, /NextContinuationToken:\s+loi.NextMarker/);
  const argumentsSource = source("cmd/api-resources.go");
  assert.match(argumentsSource, /strconv.Atoi\(values.Get\("max-keys"\)\)/);
  assert.match(argumentsSource, /prefix = values.Get\("prefix"\)/);
  assert.match(argumentsSource, /delimiter = values.Get\("delimiter"\)/);
  const response = source("cmd/api-response.go");
  assert.match(response, /NextContinuationToken\s+string\s+`xml:"NextContinuationToken,omitempty"`/);
  assert.match(response, /data.NextContinuationToken = base64.StdEncoding.EncodeToString\(\[\]byte\(nextToken\)\)/);
  assert.match(response, /data.IsTruncated = isTruncated/);
  assert.match(source("cmd/api-router.go"), /HandlerFunc\(s3APIMiddleware\(api.ListObjectsV2Handler\)\)\.\s+Queries\("list-type", "2"\)/);
  assert.match(source("cmd/bucket-listobjects-handlers.go"), /objectAPI.ListObjectsV2\(ctx, bucket, prefix, token, delimiter, maxKeys, fetchOwner, startAfter\)/);
  context.diagnostic(JSON.stringify({ sourceFile: "cmd/erasure-server-pool.go", shortcutStartLine: pool.slice(0, start).split("\n").length,
    staticExplanation: "exact-prefix object lookup returns named zero-value truncation/token fields without listFn", instrumentedBranchCoverage: false,
    maxKeys2AvoidsThisBranchOnly: true, productionChange: false }));
});
