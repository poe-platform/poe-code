import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, lstat, readlink, realpath, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const own = dirname(import.meta.filename);
const live = JSON.parse(await readFile(join(own, "live.json"), "utf8"));
const { createApplication } = await import(pathToFileURL(join(live.consumer, "out/example.mjs")).href);
const events = [];
const app = await createApplication(live.config, events);
const response = await app.fetch(live.config.namespaceUrl, { method: "PROPFIND", redirect: "manual", credentials: "omit",
  headers: { Authorization: live.config.authorization, Depth: "infinity", "Content-Type": "application/xml" },
  body: '<d:propfind xmlns:d="DAV:"><d:prop><d:lockdiscovery/></d:prop></d:propfind>', signal: AbortSignal.timeout(10000) });
const text = await response.text();
await writeFile(join(live.output, "final-lock-discovery.json"), JSON.stringify({ status: response.status,
  headers: Object.fromEntries(response.headers), text, wire: events }, null, 2));
assert.equal(response.status, 207);
assert.match(text, /lockdiscovery/u);
assert.doesNotMatch(text, /<(?:[\w.-]+:)?activelock(?:\s|>)/u);
const inspected = JSON.parse(execFileSync(live.python, ["-I", "-B", "-c", "import sys,json; print(json.dumps({'executable':sys.executable,'baseExecutable':sys._base_executable}))"],
  { env: { PATH: "/opt/homebrew/bin:/usr/bin:/bin", HOME: join(live.workspace, "home"), PYTHONNOUSERSITE: "1" }, encoding: "utf8" }));
const binaries = {};
for (const [name, path] of Object.entries({ node: process.execPath, ...inspected, openssl: "/usr/bin/openssl" })) {
  binaries[name] = { requested: path, realpath: await realpath(path), sha256: createHash("sha256").update(await readFile(path)).digest("hex") };
}
await writeFile(join(live.output, "binary-hashes.json"), JSON.stringify(binaries, null, 2));
async function tree(path) {
  const observed = await lstat(path);
  const common = { dev: observed.dev, ino: observed.ino, mode: observed.mode };
  if (observed.isSymbolicLink()) return { ...common, type: "symlink", target: await readlink(path) };
  if (observed.isDirectory()) {
    const entries = {};
    for (const name of (await readdir(path)).sort()) entries[name] = await tree(join(path, name));
    return { ...common, type: "directory", entries };
  }
  const bytes = await readFile(path);
  return { ...common, type: "file", hex: bytes.toString("hex"), sha256: createHash("sha256").update(bytes).digest("hex") };
}
await writeFile(join(live.output, "final-native-tree.json"), JSON.stringify(await tree(live.config.serverRoot), null, 2));
await writeFile(join(live.output, "post-live.json"), JSON.stringify({ actualInfiniteDepthLockDiscoveryEmpty: true,
  binaryHashes: binaries, recordedAt: new Date().toISOString(), nativeWitnessesCapturedBeforeCleanup: true }, null, 2));
console.log("Actual final lockdiscovery empty; native tree and executable hashes retained");
