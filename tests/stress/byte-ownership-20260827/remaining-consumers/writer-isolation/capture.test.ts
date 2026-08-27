import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const base = "tests/stress/byte-ownership-20260827/remaining-consumers";
const canonical = `${base}/direct-curl/direct-curl.test.ts`;
const driver = `${base}/writer-isolation/capture.mjs`;
const args = ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-reporter=tap", canonical];
const childEnv: NodeJS.ProcessEnv = { ...process.env, VIRTUAL_BASH_DIRECT_CURL_CAPTURE: "" };
delete childEnv.NODE_TEST_CONTEXT;
const sandbox = () => {
  const directory = mkdtempSync(join(tmpdir(), "virtual-bash-writer-test-"));
  try {
    cpSync(join(root, "src"), join(directory, "src"), { recursive: true });
    for (const file of ["package.json", "package-lock.json", "tsconfig.json"]) cpSync(join(root, file), join(directory, file));
    mkdirSync(join(directory, base, "writer-isolation"), { recursive: true });
    cpSync(join(root, base, "direct-curl"), join(directory, base, "direct-curl"), { recursive: true });
    cpSync(join(root, driver), join(directory, driver));
    symlinkSync(join(root, "node_modules"), join(directory, "node_modules"), "dir");
    return directory;
  } catch (error) { rmSync(directory, { recursive: true, force: true }); throw error; }
};
const immutable = (directory: string) => Object.fromEntries(readdirSync(join(directory, base, "direct-curl/artifacts")).sort().map(name => [name,
  createHash("sha256").update(readFileSync(join(directory, base, "direct-curl/artifacts", name))).digest("hex"),
]));
const canonicalChild = (directory: string) => new Promise<string>((resolve, reject) => {
  const child = spawn(process.execPath, args, {
    cwd: directory, env: childEnv, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
  const collect = (chunk: Buffer) => { output += chunk.toString(); if (output.length > 1024 * 1024) child.kill("SIGKILL"); };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  child.once("error", error => { clearTimeout(timer); reject(error); });
  child.once("close", code => {
    clearTimeout(timer);
    if (code === 0) resolve(output); else reject(new Error(`Canonical child exit ${code}: ${output}`));
  });
});

test("default parallel canonical runs preserve sealed artifacts without capture", { timeout: 30_000 }, async () => {
  const directory = sandbox();
  try {
    const before = immutable(directory);
    const results = await Promise.allSettled([canonicalChild(directory), canonicalChild(directory)]);
    for (const result of results) {
      assert.equal(result.status, "fulfilled", result.status === "rejected" ? String(result.reason) : "");
      if (result.status === "fulfilled") {
        assert.match(result.value, /# pass 2\n/);
        assert.doesNotMatch(result.value, /VIRTUAL_BASH_DIRECT_CURL_OBSERVATION/);
      }
    }
    assert.deepEqual(immutable(directory), before);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

for (const corrupt of [false, true]) {
  test(`explicit capture preserves ${corrupt ? "byte assertion failure" : "success"} separately`, { timeout: 30_000 }, () => {
    const directory = sandbox();
    let captureDirectory: string | undefined;
    try {
      if (corrupt) {
        const body = join(directory, "src/commands/network/body.ts");
        const source = readFileSync(body, "utf8");
        assert.ok(source.includes("cache.push(new Uint8Array(chunk))"));
        writeFileSync(body, source.replace("cache.push(new Uint8Array(chunk))", "cache.push(chunk.slice())"));
      }
      const before = immutable(directory);
      const child = spawnSync(process.execPath, ["--unhandled-rejections=strict", driver], {
        cwd: directory, env: childEnv, encoding: "utf8", timeout: 25_000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024,
      });
      assert.equal(child.error, undefined);
      assert.ok(child.stdout.trim(), child.stderr);
      const result = JSON.parse(child.stdout) as { directory: string; exitCode: number };
      captureDirectory = result.directory;
      assert.equal(child.status, corrupt ? 1 : 0, child.stderr);
      assert.equal(result.exitCode, child.status);
      const manifest = JSON.parse(readFileSync(join(captureDirectory, "manifest.json"), "utf8"));
      const observations = JSON.parse(readFileSync(join(captureDirectory, "observations.json"), "utf8"));
      assert.equal(observations.length, 2);
      assert.equal(manifest.before.sha256, manifest.after.sha256);
      assert.deepEqual(manifest.errors, []);
      assert.equal(manifest.before.files[canonical], createHash("sha256").update(readFileSync(join(directory, canonical))).digest("hex"));
      assert.equal(manifest.expectedVectorsSha256, createHash("sha256").update(readFileSync(join(directory, base, "direct-curl/expectations.json"))).digest("hex"));
      assert.match(readFileSync(join(captureDirectory, "raw.tap"), "utf8"), corrupt ? /# fail 1\n/ : /# pass 2\n/);
      if (corrupt) assert.notDeepEqual(observations[0].requests[1].bytes, observations[0].expectedSecond);
      assert.deepEqual(immutable(directory), before);
      for (const options of [{ args: [captureDirectory], env: childEnv }, { args: [], env: { ...childEnv, TMPDIR: directory, TMP: directory, TEMP: directory } }]) {
        const refused = spawnSync(process.execPath, ["--unhandled-rejections=strict", driver, ...options.args], {
          cwd: directory, env: options.env, encoding: "utf8", timeout: 5_000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024,
        });
        assert.equal(refused.status, 1);
        assert.match(refused.stderr, /Capture accepts no paths|temp root must be outside/);
      }
    } finally {
      if (captureDirectory) rmSync(captureDirectory, { recursive: true, force: true });
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
