import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, rm } from "node:fs/promises";

const owned = "tests/commands/network-stress";
const revision = "deab14d9f4b3b6f0d73f96587c74a9de23091300";
const mode = process.argv[2] ?? "baseline";
assert(["baseline", "supplement-native", "supplement-product", "types", "harness-diagnostic", "types-final"].includes(mode));
const target = `${owned}/${mode}.json`;
try { await readFile(target); throw new Error(`Refusing to overwrite ${target}`); }
catch (error) { if (error.code !== "ENOENT") throw error; }
function git(...args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
async function snapshot() {
  const paths = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await walk(path); else paths.push(path);
    }
  }
  for (const directory of ["src/commands/network", "src/shell", "src/fs", "src/contracts", owned]) await walk(directory);
  paths.push("src/index.ts", "package.json", "tests/commands/network/tls/cert.pem", "tests/commands/network/tls/key.pem");
  const hashes = {};
  for (const path of paths.sort()) {
    if (path.startsWith(owned) && !/\.(ts|mjs)$/.test(path) && !path.endsWith("oracle.json") && !path.endsWith("handoff.json")) continue;
    hashes[path] = createHash("sha256").update(await readFile(path)).digest("hex");
  }
  const network = Object.entries(hashes).filter(([path]) => path.startsWith("src/commands/network/"));
  return { at: new Date().toISOString(), head: git("rev-parse", "HEAD"), status: git("status", "--short"), hashes,
    networkDigest: createHash("sha256").update(JSON.stringify(network)).digest("hex"),
    networkMatchesHandoff: network.every(([path, hash]) => {
      const result = spawnSync("git", ["show", `${revision}:${path}`]);
      return result.status === 0 && createHash("sha256").update(result.stdout).digest("hex") === hash;
    }) };
}
const before = await snapshot();
assert(before.networkMatchesHandoff, "Network source differs from author handoff");
if (mode === "supplement-product") {
  const pins = JSON.parse(await readFile(`${owned}/supplement-pins.json`, "utf8"));
  for (const [path, hash] of Object.entries(pins.hashes)) assert.equal(createHash("sha256").update(await readFile(path)).digest("hex"), hash, `Supplementary evidence changed: ${path}`);
}
const args = mode === "baseline" ? [`${owned}/watchdog.mjs`, "product"]
  : mode.startsWith("types") ? [`${owned}/watchdog.mjs`, "typecheck"]
  : mode === "harness-diagnostic" ? ["--unhandled-rejections=strict", "--import", "tsx", `${owned}/harness-diagnostic.ts`]
  : ["--unhandled-rejections=strict", "--import", "tsx", `${owned}/supplement.ts`, mode === "supplement-native" ? "native" : "product"];
const previousRoots = new Set(await readdir(owned));
const child = spawn(process.execPath, args, { shell: false, detached: true, env: { ...process.env, CURL_VERIFY_AFTER_HANDOFF: revision }, stdio: ["ignore", "pipe", "pipe"] });
const terminate = (signal) => {
  if (!child.pid) return;
  try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== "ESRCH") throw error; }
};
const interrupt = () => terminate("SIGTERM");
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => { stdout += chunk; process.stdout.write(chunk); });
child.stderr.on("data", (chunk) => { stderr += chunk; process.stderr.write(chunk); });
const timer = setTimeout(() => terminate("SIGTERM"), 430000);
const hardTimer = setTimeout(() => terminate("SIGKILL"), 432000);
const exit = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal })); });
clearTimeout(timer);
clearTimeout(hardTimer);
process.off("SIGINT", interrupt);
process.off("SIGTERM", interrupt);
terminate("SIGKILL");
for (const name of await readdir(owned)) {
  if (!previousRoots.has(name) && /^\.supp-native-[A-Za-z0-9]{6}$/.test(name)) await rm(`${owned}/${name}`, { recursive: true, force: true });
}
const after = await snapshot();
const changes = Object.keys(before.hashes).filter((path) => before.hashes[path] !== after.hashes[path]);
const artifact = { schema: 1, mode, revision, command: [process.execPath, ...args], environment: { CURL_VERIFY_AFTER_HANDOFF: revision, strictUnhandledRejections: true }, before, after, changes,
  networkStable: before.networkDigest === after.networkDigest, exit, stdout, stderr,
  records: mode.startsWith("types") ? [] : stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) };
const text = JSON.stringify(artifact, null, 2) + "\n";
const patch = `*** Begin Patch\n*** Add File: ${target}\n${text.trimEnd().split("\n").map((line) => `+${line}`).join("\n")}\n*** End Patch\n`;
const saved = spawnSync("apply_patch", { input: patch, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
assert.equal(saved.status, 0, saved.stderr);
process.stdout.write(saved.stdout);
assert(artifact.networkStable && after.networkMatchesHandoff, "Network source changed during execution");
process.exitCode = exit.code ?? 1;
