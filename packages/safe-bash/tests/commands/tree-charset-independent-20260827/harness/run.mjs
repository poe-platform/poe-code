import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const harness = dirname(fileURLToPath(import.meta.url));
const consumer = resolve(process.env.CONSUMER_ROOT);
const controlsRoot = resolve(process.env.CONTROLS_ROOT);
const timeoutMs = 30000;

async function run(label, script, cwd, extraEnv = {}) {
  const child = spawn(process.execPath, ["--unhandled-rejections=strict", script], {
    cwd,
    env: { PATH: dirname(process.execPath), LANG: "C", LC_ALL: "C", TZ: "UTC", ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const pid = child.pid;
  const stdout = [], stderr = [];
  child.stdout.on("data", bytes => stdout.push(bytes));
  child.stderr.on("data", bytes => stderr.push(bytes));
  const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
  const outcome = await new Promise(accept => child.once("close", (code, signal) => accept({ code, signal })));
  clearTimeout(timer);
  let absent = false;
  try { process.kill(pid, 0); } catch (error) { absent = error?.code === "ESRCH"; }
  return { label, pid, ...outcome, absentAfterClose: absent, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
}

const common = {
  CANDIDATE: process.env.CANDIDATE,
  TREE_CHARSET: "UTF8",
  EXPECTED_PACKAGE_MANIFEST_SHA256: process.env.EXPECTED_PACKAGE_MANIFEST_SHA256,
  EXPECTED_ROOT_ENTRY_SHA256: process.env.EXPECTED_ROOT_ENTRY_SHA256,
  EXPECTED_TREE_ENTRY_SHA256: process.env.EXPECTED_TREE_ENTRY_SHA256,
};
const baseline = await run("baseline", join(consumer, "consumer.mjs"), consumer, common);
assert.equal(baseline.code, 0, baseline.stderr);
assert.equal(baseline.signal, null);
assert.equal(baseline.absentAfterClose, true);
const baselineJson = JSON.parse(baseline.stdout);
assert.equal(baselineJson.pass, true);

const wrongHash = await run("wrong-package-hash", join(consumer, "consumer.mjs"), consumer, {
  ...common, EXPECTED_PACKAGE_MANIFEST_SHA256: "0".repeat(64),
});
assert.notEqual(wrongHash.code, 0);
assert.equal(wrongHash.absentAfterClose, true);

const empty = join(controlsRoot, "empty-consumer");
await mkdir(empty, { recursive: true });
await cp(join(harness, "missing-package.mjs"), join(empty, "missing-package.mjs"));
await writeFile(join(empty, "package.json"), '{"private":true,"type":"module"}\n');
const missing = await run("missing-package-no-source-fallback", join(empty, "missing-package.mjs"), empty, {
  NODE_PATH: process.env.CANDIDATE_DIST,
});
assert.notEqual(missing.code, 0);
assert.match(missing.stderr, /ERR_MODULE_NOT_FOUND|Cannot find package/u);
assert.equal(missing.absentAfterClose, true);

const wrong = join(controlsRoot, "wrong-consumer");
await mkdir(join(wrong, "node_modules/virtual-bash"), { recursive: true });
await cp(join(harness, "wrong-package.mjs"), join(wrong, "wrong-package.mjs"));
await writeFile(join(wrong, "package.json"), '{"private":true,"type":"module"}\n');
await writeFile(join(wrong, "node_modules/virtual-bash/package.json"), '{"name":"virtual-bash","version":"9.9.9","type":"module","exports":"./index.js"}\n');
await writeFile(join(wrong, "node_modules/virtual-bash/index.js"), 'export const marker = "wrong-package";\n');
const wrongPackage = await run("wrong-package-no-candidate-fallback", join(wrong, "wrong-package.mjs"), wrong);
assert.notEqual(wrongPackage.code, 0);
assert.match(wrongPackage.stderr, /wrong package was detected/u);
assert.equal(wrongPackage.absentAfterClose, true);

await rm(controlsRoot, { recursive: true, force: true });
process.stdout.write(JSON.stringify({
  schema: 1,
  baseline: { ...baseline, stdout: baselineJson },
  expectedFailureControls: [wrongHash, missing, wrongPackage],
  childClosure: [baseline, wrongHash, missing, wrongPackage].every(item => item.absentAfterClose),
  pass: true,
}, null, 2) + "\n");
