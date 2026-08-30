import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { release } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fileHash, inventory, readJson, sha256 } from "./telemetry.mjs";

export const here = dirname(fileURLToPath(import.meta.url));
export const repository = resolve(here, "../../../../..");
export const pin = readJson(join(here, "PIN.json"));
export const gitEnv = { PATH: "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_NO_REPLACE_OBJECTS: "1", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" };
export function git(args) {
  return execFileSync(pin.tools.git.path, ["--no-replace-objects", "-C", repository, ...args], { env: gitEnv, maxBuffer: 1024 * 1024, timeout: 10000 });
}
export function authenticate(freeze, manifestSha) {
  assert.match(freeze, /^[a-f0-9]{40}$/u);
  assert.match(manifestSha, /^[a-f0-9]{64}$/u);
  assert.equal(process.version, pin.nodeVersion);
  assert.equal(process.platform, pin.platform);
  assert.equal(process.arch, pin.arch);
  assert.equal(release(), pin.osRelease);
  assert.equal(realpathSync(process.execPath), pin.tools.node.realpath);
  const tools = {};
  for (const [name, tool] of Object.entries(pin.tools)) {
    assert.equal(realpathSync(tool.path), tool.realpath);
    tools[name] = fileHash(tool.path);
    assert.equal(tools[name], tool.sha256);
  }
  const manifestPath = relative(repository, join(here, "MANIFEST.json"));
  const committed = git(["show", `${freeze}:${manifestPath}`]);
  assert.equal(sha256(committed), manifestSha);
  assert.equal(fileHash(join(here, "MANIFEST.json")), manifestSha);
  const manifest = JSON.parse(committed), current = inventory(here);
  assert.deepEqual(current.directories, []);
  assert.deepEqual(Object.keys(current.files).sort(), [...Object.keys(manifest.files), "MANIFEST.json"].sort());
  const committedFiles = git(["ls-tree", "-r", "--name-only", freeze, "--", relative(repository, here)]).toString().trim().split("\n").map(path => path.slice(relative(repository, here).length + 1));
  assert.deepEqual(committedFiles.sort(), Object.keys(current.files).sort());
  for (const [path, hash] of Object.entries(manifest.files)) {
    assert.equal(current.files[path], hash, path);
    assert.equal(sha256(git(["show", `${freeze}:${relative(repository, join(here, path))}`])), hash, path);
  }
  const sources = {};
  for (const source of pin.sources) {
    sources[source.name] = sha256(git(["show", `${source.commit}:${source.path}`]));
    assert.equal(sources[source.name], source.sha256, source.name);
  }
  const base = pin.sources.find(source => source.name === "v2-seal");
  const seal = JSON.parse(git(["show", `${base.commit}:${base.path}`]));
  assert.equal(current.files["core.mjs"], seal.files["core.mjs"]);
  assert.equal(current.files["stream-fixture.mjs"], seal.files["stream-fixture.mjs"]);
  const diagnosis = pin.sources.find(source => source.name === "diagnosis");
  const diagnosisManifest = pin.sources.find(source => source.name === "diagnosis-manifest");
  assert.equal(JSON.parse(git(["show", `${diagnosisManifest.commit}:${diagnosisManifest.path}`])).files["DIAGNOSIS.data"].sha256, diagnosis.sha256);
  return { at: new Date().toISOString(), freeze, manifestSha256: manifestSha, tools, sources, recipeInventory: current, candidateRuntime: 0, archiveReplay: false };
}
