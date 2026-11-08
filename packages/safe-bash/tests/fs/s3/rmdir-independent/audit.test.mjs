import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, "../../../..");
const evidence = join(owned, "evidence-onRW9e");
const json = (name, base = evidence) => JSON.parse(readFileSync(join(base, name)));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const freeze = json("freeze.json");
const closure = json("emitted-closure.json");
const observations = json("service-observations.json");
const service = join(evidence, basename(observations.output));

test("all archived inputs and entire emitted closure match committed source and pack", () => {
  const temporary = mkdtempSync(join(owned, ".audit-"));
  try {
    for (const archive of ["source.tar.gz", "tests.tar.gz", "matrix.tar.gz"]) execFileSync("tar", ["-xzf", join(evidence, archive), "-C", temporary]);
    for (const entry of freeze.manifest) assert.equal(hash(readFileSync(join(temporary, entry.path))), entry.sha256, entry.path);
    const packed = join(temporary, "packed");
    mkdirSync(packed);
    assert.equal(hash(readFileSync(join(evidence, closure.tarball))), closure.tarballSha256);
    execFileSync("tar", ["-xzf", join(evidence, closure.tarball), "--strip-components=1", "-C", packed]);
    assert.equal(closure.files.length, 636);
    for (const entry of closure.files) assert.equal(hash(readFileSync(join(packed, entry.path))), entry.sha256, entry.path);
    assert.deepEqual(closure.runtimeDependencies, {});
    const tree = revision => execFileSync("git", ["rev-parse", `${revision}:src/fs/s3`], { cwd: root, encoding: "utf8" }).trim();
    assert.equal(tree(freeze.sourceRevision), tree("5660248"));
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("unchanged cohort denominators, sole original matrix failure and verifier correction are retained", () => {
  const commands = json("commands.json");
  for (const [name, total, failures] of [["original-s3-http382", 382, 0], ["original-wrappers16", 16, 0], ["original-alias49", 49, 0],
    ["original-integrations6", 6, 0], ["original-preflight30", 30, 0], ["original-matrix79", 79, 1], ["independent", 24, 0]]) {
    const result = commands.find(command => command.name === name);
    assert.deepEqual(result.counts, { tests: total, pass: total - failures, fail: failures, cancelled: 0, skipped: 0, todo: 0 });
    assert.equal(result.status, failures ? 1 : 0);
  }
  assert.deepEqual(commands.find(command => command.name === "original-matrix79").failures, ["webdav: create, copy, append, inspect and remove files"]);
  assert.match(readFileSync(join(evidence, "original-matrix79.stdout"), "utf8"), /rmdir: ENOTSUP/);
  const first = json("commands.json", join(owned, "evidence-jgwdUq")).find(command => command.name === "independent");
  assert.equal(first.counts.pass, 22);
  assert.equal(first.counts.fail, 2);
  for (const name of ["build", "scoped-types", "public-probe", "public-types", "service20-and-wire"]) assert.equal(commands.find(command => command.name === name).status, 0);
});

test("actual loaded root/S3/HTTP and all 144 service modules match packed/build closure", () => {
  for (const name of ["probe", "independent", "service"]) {
    const records = readFileSync(join(evidence, `${name}-loads.jsonl`), "utf8").trim().split("\n").map(line => JSON.parse(line));
    for (const record of records) {
      assert.match(record.url, /\/consumer\/node_modules\/virtual-bash\/dist\//);
      const path = record.url.split("/node_modules/virtual-bash/")[1];
      assert.equal(closure.files.find(entry => entry.path === path)?.sha256, record.sha256);
    }
    assert.equal(new Set(records.map(record => record.url)).size, 144);
  }
  for (const module of json("service-runtime-resolution.json").modules) {
    const path = module.url.split("/node_modules/virtual-bash/")[1];
    assert.equal(closure.files.find(entry => entry.path === path)?.sha256, module.sha256);
  }
  assert.match(readFileSync(join(evidence, "resolution-before-boundary.stdout"), "utf8"), /safe-bash\/dist\/index.js/);
  const original = "tests/fs/s3/rmdir-real-service/snapshot-profile/service-checks.mjs";
  assert.equal(json("service-runtime-resolution.json").checksSha256, freeze.manifest.find(entry => entry.path === original).sha256);
});

test("20 observations are not 20 successful workflows; every rmdir DELETE is exact-marker-only", () => {
  assert.equal(observations.results.length, 20);
  assert.equal(observations.results.filter(result => result.passed).length, 20);
  assert.equal(observations.results.filter(result => result.kind === "public positive workflow").length, 4);
  const trace = json("product-requests.json", service);
  const deleteRows = trace.filter(entry => entry.method === "DELETE");
  assert.equal(deleteRows.length, 10);
  const explicitFile = "/safe-bash-interop/snapshot/pipeline/file";
  assert.equal(deleteRows.filter(entry => entry.path === explicitFile).length, 1);
  const markerRows = deleteRows.filter(entry => entry.path !== explicitFile);
  assert.deepEqual(markerRows.map(entry => entry.path), ["api", "shell", "rm-dir", "pipeline", "race", "aba", "forbidden", "abort-delete", "lost-response"]
    .map(name => `/safe-bash-interop/snapshot/${name}/`));
  assert.equal(markerRows.filter(entry => entry.status === 204).length, 8);
  assert.equal(markerRows.filter(entry => entry.status === 403).length, 1);
  for (const row of observations.results) {
    const deletes = trace.slice(...row.productRequests).filter(entry => entry.method === "DELETE");
    if (!row.observation.deletes) assert.deepEqual(deletes, [], row.name);
  }
  const profile = observations.results.find(row => row.kind === "public profile").observation;
  assert.equal(profile.filesystem.snapshotRmdir, true);
  assert.equal(profile.filesystem.atomicRename, false);
  assert.equal(profile.transport.conditionalDelete, false);
  assert.equal(observations.results.find(row => row.kind === "public snapshot race").observation.logicalDirectoryStillVisible, true);
  assert.equal(observations.results.find(row => row.kind === "public snapshot identity limit").observation.replacementRemoved, true);
});

function sign(method, target, headers, scope, names, body, secret) {
  const [pathname, query = ""] = target.split("?");
  const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  const canonicalQuery = [...new URLSearchParams(query)].map(([name, value]) => `${encode(name)}=${encode(value)}`).sort().join("&");
  const canonicalHeaders = names.map(name => `${name}:${headers[name].trim().replace(/\s+/g, " ")}\n`).join("");
  const canonical = [method, pathname, canonicalQuery, canonicalHeaders, names.join(";"), hash(body)].join("\n");
  let key = Buffer.from("AWS4" + secret);
  for (const component of scope.split("/")) key = createHmac("sha256", key).update(component).digest();
  return createHmac("sha256", key).update(["AWS4-HMAC-SHA256", headers["x-amz-date"], scope, hash(canonical)].join("\n")).digest("hex");
}

test("independent SigV4 recomputation verifies all 65 retained native wire requests", () => {
  const officialHeaders = { host: "examplebucket.s3.amazonaws.com", "x-amz-date": "20130524T000000Z", "x-amz-content-sha256": hash(Buffer.alloc(0)) };
  assert.equal(sign("GET", "/?prefix=J&max-keys=2", officialHeaders, "20130524/us-east-1/s3/aws4_request", Object.keys(officialHeaders).sort(),
    Buffer.alloc(0), "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"), "34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7");
  const rows = json("requests.json", service);
  const launch = json("launch.json", service);
  assert.equal(rows.length, 65);
  for (const row of rows) {
    const outbound = readFileSync(join(service, `wire-${row.sequence}.trace`), "utf8").split(/\r?\n/).filter(line => line.startsWith("> ")).map(line => line.slice(2));
    assert.equal(outbound[0], `${row.method} ${row.path} HTTP/1.1`);
    const headers = Object.fromEntries(outbound.slice(1).filter(line => line.includes(":"))
      .map(line => [line.slice(0, line.indexOf(":")).toLowerCase(), line.slice(line.indexOf(":") + 1).trim()]));
    const auth = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/([^,]+), SignedHeaders=([^,]+), Signature=(.+)$/.exec(headers.authorization);
    assert.ok(auth);
    assert.equal(auth[1], launch.environment.MINIO_ROOT_USER);
    assert.equal(headers.host, new URL(launch.endpoint).host);
    const requestPath = join(service, `wire-${row.sequence}.request`);
    const body = existsSync(requestPath) ? readFileSync(requestPath) : Buffer.alloc(0);
    assert.equal(headers["x-amz-content-sha256"], hash(body));
    assert.equal(sign(row.method, row.path, headers, auth[2], auth[3].split(";"), body, launch.environment.MINIO_ROOT_PASSWORD), auth[4], String(row.sequence));
    const response = readFileSync(join(service, `wire-${row.sequence}.body`));
    assert.equal(response.toString("base64"), row.bodyBase64);
    const responseHeaders = readFileSync(join(service, `wire-${row.sequence}.headers`), "utf8");
    assert.match(responseHeaders, new RegExp(`^HTTP/1.1 ${row.status} `));
  }
});

test("native shortcut probes retain exact keys, false completeness, and surviving hidden bytes", () => {
  const proof = json("wire-shortcut.json");
  const requests = json("requests.json", service);
  assert.equal(proof.observations.length, 6);
  for (const observation of proof.observations) {
    const row = requests.find(row => row.sequence === observation.sequence);
    const target = new URL(row.path, "http://127.0.0.1");
    assert.equal(target.searchParams.get("max-keys"), String(observation.maxKeys));
    assert.equal(target.searchParams.get("prefix"), "independent-wire/target/");
    assert.equal(target.searchParams.get("delimiter"), observation.delimiter);
    assert.equal(target.searchParams.has("continuation-token"), false);
    assert.equal(target.searchParams.has("start-after"), false);
    assert.match(row.bodyText, /<IsTruncated>false<\/IsTruncated>/);
    assert.doesNotMatch(row.bodyText, /<NextContinuationToken>/);
    assert.equal(observation.keys.length, observation.maxKeys === 1 ? 1 : 2);
  }
  assert.equal(requests.find(row => row.sequence === proof.childSequence).bodyBase64, "AP+ACg==");
  const primary = json("audit.json", join(owned, "primary-evidence-jrKWp8"));
  assert.equal(primary.sourceCommit, "07c3a429bfed433e49018cb0f78a52145d4bedeb");
  assert.equal(primary.retainedBlobs.length, 6);
  assert.equal(primary.shortcutStartLine, 1674);
  for (const document of primary.fresh) assert.equal(hash(readFileSync(join(owned, "primary-evidence-jrKWp8", document.name))), document.sha256);
});

test("original evidence remains unchanged; one pinned binary and owned service data were removed", () => {
  for (const entry of json("original-seal.json")) assert.equal(hash(readFileSync(join(root, entry.path))), entry.sha256, entry.path);
  const cleanup = json("cleanup.json");
  assert.equal(cleanup.success, true);
  assert.equal(cleanup.removed, true);
  assert.equal(existsSync(cleanup.scratch), false);
  assert.deepEqual(cleanup.changedOriginals, []);
  assert.deepEqual(cleanup.changedFrozen, []);
  assert.equal(cleanup.serviceShutdowns.length, 1);
  assert.equal(cleanup.serviceShutdowns[0].code, 0);
  assert.equal(existsSync(join(service, "home")), false);
  assert.equal(existsSync(join(service, "data")), false);
  const download = json("download.json");
  assert.equal(download.sha256, "7c3b3039b76e55a1b80935848ed83998d5e8d317374f87851f46a019ff5c0aa4");
  assert.equal(download.size, 108218434);
  assert.equal(json("commands.json").filter(command => command.name === "single-pinned-download").length, 1);
});
