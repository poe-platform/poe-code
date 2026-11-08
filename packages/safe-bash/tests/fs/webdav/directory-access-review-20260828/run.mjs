import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";

const own = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(own, "../../../..");
const base = "5137a74ec855a32d8a8860eb66b62eb44d11e290";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => {
  const child = spawnSync("git", args, { cwd: repository, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(child.status, 0, child.stderr.toString());
  return child.stdout;
};
const sources = ["src/fs/webdav/webdav.ts", "src/fs/webdav/xml.ts", "src/fs/webdav/README.md", "src/fs/readonly/index.ts",
  "src/contracts/filesystem.ts", "src/contracts/filesystem.md", "src/shell/runtime.ts"];
const fixtures = ["cases.json", "README.md", "run.mjs", "primary.mjs", "primary.json", "primary-v2.json"];
const sourceHashes = () => Object.fromEntries(sources.map(name => [name, hash(git("show", `${base}:${name}`))]));
const liveHashes = () => Object.fromEntries(sources.map(name => [name, hash(fs.readFileSync(path.join(repository, name)))]));
const fixtureHashes = () => Object.fromEntries(fixtures.map(name => [name, hash(fs.readFileSync(path.join(own, name)))]));
const freezePath = path.join(own, "FREEZE.json");
if (process.argv[2] === "--seal") {
  assert.deepEqual(liveHashes(), sourceHashes());
  fs.writeFileSync(freezePath, JSON.stringify({ sealedAt: new Date().toISOString(), base, source: sourceHashes(),
    fixtures: fixtureHashes(), cases: 30, baselineCallsBeforeSeal: 0, productionCandidate: false,
    node: { path: fs.realpathSync(process.execPath), sha256: hash(fs.readFileSync(process.execPath)), version: process.version },
    packageEvidence: "tests/integration/combined77-stage2-independent-20260828/actual-01.json.gz.base64",
    packageEvidenceSha256: "88fadf81a9ab984e4c25ff26f9f1d13331967549c0dbe08fbce268ee7ed1da12",
    packageSha256: "13fe54de1cf900d587855e276375fdf72ed1ed0d0e0625cf7ef00730f2bb74c9" }, null, 2) + "\n", { flag: "wx" });
  console.log(freezePath);
  process.exit(0);
}
assert.equal(process.argv[2], "--capture");
const freeze = JSON.parse(fs.readFileSync(freezePath, "utf8"));
assert.deepEqual(fixtureHashes(), freeze.fixtures);
assert.deepEqual(sourceHashes(), freeze.source);
assert.deepEqual(liveHashes(), freeze.source);
assert.equal(hash(fs.readFileSync(process.execPath)), freeze.node.sha256);
const freezeCommit = git("log", "-1", "--format=%H", "--", path.relative(repository, freezePath)).toString().trim();
assert.equal(hash(git("show", `${freezeCommit}:${path.relative(repository, freezePath)}`)), hash(fs.readFileSync(freezePath)));
const output = path.join(own, "observations-01.json.gz.base64");
assert.equal(fs.existsSync(output), false);
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "safe-bash-dav-access-design-")));
const data = { freezeCommit, freeze, startedAt: new Date().toISOString(), root, observations: [], failures: [], children: 0 };
const inventory = directory => {
  const result = {};
  const visit = (current, relative) => {
    for (const name of fs.readdirSync(current).sort()) {
      const filename = path.join(current, name), key = relative ? `${relative}/${name}` : name, stat = fs.lstatSync(filename);
      if (stat.isDirectory()) visit(filename, key);
      else { assert.ok(stat.isFile()); result[key] = { sha256: hash(fs.readFileSync(filename)), bytes: stat.size, mode: stat.mode & 0o777 }; }
    }
  };
  visit(directory, "");
  return result;
};
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const xml = body => `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${body}</d:multistatus>`;
const property = (type, code = 200, extra = "") => `<d:propstat><d:prop><d:resourcetype>${type}</d:resourcetype>${extra}</d:prop><d:status>HTTP/1.1 ${code} Fixture</d:status></d:propstat>`;
const member = (href, body) => `<d:response><d:href>${href}</d:href>${body}</d:response>`;
const collection = href => member(href, property("<d:collection/>"));
const file = href => member(href, property("", 200, "<d:getcontentlength>3</d:getcontentlength>"));
try {
  const compressed = Buffer.from(fs.readFileSync(path.join(repository, freeze.packageEvidence), "utf8"), "base64");
  assert.equal(hash(compressed), freeze.packageEvidenceSha256);
  const accepted = JSON.parse(gunzipSync(compressed));
  const tarball = Buffer.from(accepted.package.base64, "base64");
  assert.equal(hash(tarball), freeze.packageSha256);
  const packageRoot = path.join(root, "node_modules/virtual-bash");
  fs.mkdirSync(packageRoot, { recursive: true });
  const extraction = spawnSync("/usr/bin/tar", ["-xz", "--strip-components=1", "-C", packageRoot], { input: tarball, timeout: 10000 });
  data.children++;
  assert.equal(extraction.status, 0, extraction.stderr.toString());
  data.packageBefore = inventory(packageRoot);
  assert.deepEqual(data.packageBefore, accepted.packageInventory);
  const publicUrl = pathToFileURL(path.join(packageRoot, "dist/index.js")).href;
  const api = await import(publicUrl);
  data.publicImport = { url: publicUrl, sha256: hash(fs.readFileSync(fileURLToPath(publicUrl))) };
  for (const fixture of JSON.parse(fs.readFileSync(path.join(own, "cases.json"), "utf8"))) {
    const observation = { ...fixture, requests: [], outcomes: [], bodyPulls: 0, bodyCancels: 0, shellsDisposed: 0, lateDeliveries: 0 };
    const controller = new AbortController();
    const reason = Object.freeze({ abort: fixture.id });
    const responses = [], scheduled = [];
    const trackedResponse = (body, init) => { const response = new Response(body, init); responses.push(response); return response; };
    const slowResponse = abortBody => trackedResponse(new ReadableStream({
      pull(stream) {
        observation.bodyPulls++;
        if (observation.bodyPulls === 1) {
          stream.enqueue(new TextEncoder().encode("<d:multistatus xmlns:d=\"DAV:\">"));
          if (abortBody) queueMicrotask(() => controller.abort(reason));
        } else if (!abortBody) stream.error(reason);
      },
      cancel() { observation.bodyCancels++; },
    }, { highWaterMark: 0 }), { status: 207 });
    const lateResponse = () => trackedResponse(new ReadableStream({ cancel() { observation.bodyCancels++; } }, { highWaterMark: 0 }), { status: 207 });
    const fetch = async (url, init) => {
      const headers = new Headers(init.headers);
      observation.requests.push({ url, method: init.method, depth: headers.get("depth"), redirect: init.redirect,
        credentials: init.credentials, authorization: headers.get("authorization"), cacheControl: headers.get("cache-control"),
        signalPresent: init.signal instanceof AbortSignal, body: init.body });
      const profile = fixture.profile, pathname = new URL(url).pathname;
      if (profile === "abort-fetch" || profile === "deadline-late-response") {
        const pending = wait(35).then(() => { observation.lateDeliveries++; return lateResponse(); });
        scheduled.push(pending);
        if (profile === "abort-fetch") queueMicrotask(() => controller.abort(reason));
        return pending;
      }
      if (profile === "abort-body" || profile === "late-body-error") return slowResponse(profile === "abort-body");
      if (/^http\d+$/.test(profile)) return trackedResponse(null, { status: Number(profile.slice(4)) });
      if (profile === "listing-denied" && headers.get("depth") === "1") return trackedResponse(null, { status: 403 });
      if (profile === "child-denied" && pathname.endsWith("/secret")) return trackedResponse(null, { status: 403 });
      if (profile === "ancestor-file" && pathname.endsWith("/secret")) return trackedResponse(null, { status: 404 });
      if (profile === "slash-redirect" && !pathname.endsWith("/")) return trackedResponse(null, { status: 301, headers: { Location: `${pathname}/` } });
      if (profile === "outside-redirect") return trackedResponse(null, { status: 301, headers: { Location: "https://outside.invalid/dav/folder/" } });
      const href = profile === "wrong-href" ? "/outside/folder" : pathname;
      let body = collection(href);
      if (profile === "type-denied") body = member(href, property("<d:collection/>", 403));
      if (profile === "type-missing") body = member(href, property("", 404));
      if (profile === "unknown-type") body = member(href, property('<u:opaque xmlns:u="urn:fixture"/>'));
      if (profile === "collection-with-extension") body = member(href, property('<d:collection/><u:opaque xmlns:u="urn:fixture"/>'));
      if (profile === "file" || profile === "ancestor-file") body = file(href);
      if (profile === "extra-child" || profile === "entry-limit") body += file(`${href}/secret`);
      if (profile === "missing-self") body = "";
      if (profile === "duplicate-self") body += body;
      if (profile === "optional-denied") body = member(href, property("<d:collection/>") + '<d:propstat><d:prop><d:getetag/></d:prop><d:status>HTTP/1.1 403 Forbidden</d:status></d:propstat>');
      return trackedResponse(profile === "invalid-xml" ? "<broken" : xml(body), { status: 207,
        headers: profile === "paginated" ? { Link: '</dav/page2>; rel="next"' } : {} });
    };
    const filesystem = new api.WebDavFileSystem({ baseUrl: "https://provider.invalid/dav/", fetch,
      headers: { Authorization: "Bearer synthetic-directory-review" },
      timeoutMs: fixture.profile === "deadline-late-response" ? 5 : 500,
      ...(fixture.profile === "xml-limit" ? { maxXmlBytes: 32 } : {}),
      ...(fixture.profile === "entry-limit" ? { maxEntries: 1 } : {}) });
    const readonly = new api.ReadOnlyFileSystem(filesystem);
    if (fixture.profile === "preaborted") controller.abort(reason);
    const options = { signal: controller.signal };
    for (const action of fixture.actions) {
      const before = observation.requests.length;
      try {
        let value;
        if (action === "stat") value = (await filesystem.stat("/folder", options)).type;
        else if (action === "stat-child") value = (await filesystem.stat("/folder/secret", options)).type;
        else if (action === "stat-slash") value = (await filesystem.stat("/folder/", options)).type;
        else if (action === "cd" || action === "readonly-cd") {
          const shell = new api.Shell({ fs: action === "cd" ? filesystem : readonly, cwd: "/", env: { PATH: "", HOME: "/" } });
          try {
            const result = await shell.exec("cd /folder; pwd");
            value = `cd${result.exitCode}`;
            observation.cd = { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
          } finally { await shell.dispose(); observation.shellsDisposed++; }
        } else if (action.startsWith("readonly-access")) value = await readonly.access("/folder", Number(action.slice("readonly-access".length)), options);
        else value = await filesystem.access("/folder", Number(action.slice("access".length)), options);
        observation.outcomes.push({ action, returned: true, value: value ?? "void", requests: observation.requests.length - before });
      } catch (error) {
        observation.outcomes.push({ action, returned: false, code: error?.code, message: error?.message,
          typedFsError: error instanceof api.FsError, exactReason: error === reason, exactCause: error?.cause === reason,
          requests: observation.requests.length - before });
      }
    }
    await Promise.all(scheduled);
    await wait(0);
    observation.bodyLocksAfter = responses.map(response => response.body?.locked ?? false);
    observation.matched = JSON.stringify(observation.outcomes.map(outcome => outcome.returned ? outcome.value : outcome.code)) === JSON.stringify(fixture.expected);
    data.observations.push(observation);
    if (!observation.matched) data.failures.push(fixture.id);
  }
  data.packageAfter = inventory(packageRoot);
  assert.deepEqual(data.packageAfter, data.packageBefore);
} catch (error) { data.failure = { name: error?.name, message: error?.message, stack: error?.stack }; process.exitCode = 1; }
finally {
  fs.rmSync(root, { recursive: true, force: false });
  data.temporaryRemoved = !fs.existsSync(root);
  data.liveSourceAfter = liveHashes();
  data.finishedAt = new Date().toISOString();
  fs.writeFileSync(output, gzipSync(Buffer.from(JSON.stringify(data))).toString("base64") + "\n", { flag: "wx" });
}
if (data.failures.length) process.exitCode = 1;
console.log(JSON.stringify({ observations: data.observations.length, failures: data.failures, failure: data.failure ?? null,
  temporaryRemoved: data.temporaryRemoved, children: data.children, output }, null, 2));
