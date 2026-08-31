import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

type CopyBoundaries = { heldSourceFiles: string[]; heldEvidenceDirectories: string[] };
const { validateBoundaries }: { validateBoundaries(value: unknown): CopyBoundaries } = await import(new URL("../../../../../scripts/integration-inputs.mjs", import.meta.url).href);
const { isHeldInputPath }: { isHeldInputPath(path: string, boundaries: CopyBoundaries): boolean } = await import(new URL("../../../../../scripts/typecheck-integration-inputs.mjs", import.meta.url).href);

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const base = "tests/stress/byte-ownership-20260827/remaining-consumers";
const canonical = `${base}/direct-curl/direct-curl.test.ts`;
const driver = `${base}/writer-isolation/capture.mjs`;
const args = ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-reporter=tap", canonical];
const childEnv: NodeJS.ProcessEnv = { ...process.env, VIRTUAL_BASH_DIRECT_CURL_CAPTURE: "" };
delete childEnv.NODE_TEST_CONTEXT;
const sandbox = (sourceRoot = root) => {
  const directory = mkdtempSync(join(tmpdir(), "virtual-bash-writer-test-"));
  try {
    const boundaries = validateBoundaries(JSON.parse(readFileSync(join(sourceRoot, "integration-boundaries.json"), "utf8")));
    cpSync(join(sourceRoot, "src"), join(directory, "src"), { recursive: true, filter: source => {
      if (isHeldInputPath(relative(sourceRoot, source), boundaries)) return false;
      const stat = lstatSync(source);
      assert.ok(stat.isDirectory() || stat.isFile() && stat.nlink === 1, "fixture source must be regular and not a link");
      return true;
    } });
    for (const file of ["package.json", "package-lock.json", "tsconfig.json", "integration-boundaries.json"]) cpSync(join(sourceRoot, file), join(directory, file));
    mkdirSync(join(directory, "scripts"));
    for (const file of ["integration-inputs.mjs", "typecheck-integration-inputs.mjs"]) cpSync(join(root, "scripts", file), join(directory, "scripts", file));
    mkdirSync(join(directory, base, "writer-isolation"), { recursive: true });
    cpSync(join(sourceRoot, base, "direct-curl"), join(directory, base, "direct-curl"), { recursive: true });
    cpSync(join(sourceRoot, driver), join(directory, driver));
    const publicModule = fileURLToPath(import.meta.resolve("poe-code/safe-fs"));
    let peerRoot = dirname(publicModule);
    for (;;) {
      try {
        const metadata = JSON.parse(readFileSync(join(peerRoot, "package.json"), "utf8"));
        if (metadata.name === "poe-code") {
          assert.equal(resolve(peerRoot, metadata.exports["./safe-fs"].import), publicModule, "fixture must use the public canonical peer export");
          break;
        }
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      }
      const parent = dirname(peerRoot);
      assert.notEqual(parent, peerRoot, "public canonical peer metadata missing");
      peerRoot = parent;
    }
    mkdirSync(join(directory, "node_modules"));
    symlinkSync(peerRoot, join(directory, "node_modules/poe-code"), "dir");
    symlinkSync(dirname(fileURLToPath(import.meta.resolve("tsx/package.json"))), join(directory, "node_modules/tsx"), "dir");
    return directory;
  } catch (error) { rmSync(directory, { recursive: true, force: true }); throw error; }
};

test("copied writer fixtures omit held source while preserving admitted neighbors", () => {
  const source = mkdtempSync(join(tmpdir(), "virtual-bash-writer-source-"));
  let directory: string | undefined;
  try {
    for (const folder of ["src/commands/xan", "src/commands/neighbor", `${base}/direct-curl`, `${base}/writer-isolation`]) {
      mkdirSync(join(source, folder), { recursive: true });
    }
    writeFileSync(join(source, "src/commands/xan/input.ts"), "synthetic held input");
    writeFileSync(join(source, "src/commands/neighbor/input.ts"), "admitted neighbor");
    for (const file of ["package.json", "package-lock.json", "tsconfig.json"]) writeFileSync(join(source, file), "{}");
    writeFileSync(join(source, driver), "");
    writeFileSync(join(source, "integration-boundaries.json"), JSON.stringify({
      version: 1, heldSourceFiles: ["src/commands/xan/input.ts"], heldEvidenceDirectories: [], fixtureDirectories: [],
    }));
    symlinkSync(join(root, "node_modules"), join(source, "node_modules"), "dir");
    directory = sandbox(source);
    assert.equal(existsSync(join(directory, "src/commands/xan")), false);
    assert.equal(readFileSync(join(directory, "src/commands/neighbor/input.ts"), "utf8"), "admitted neighbor");
    renameSync(join(source, "src/commands/xan"), join(source, "src/commands/XAN"));
    assert.throws(() => sandbox(source), /case alias of held/);
    renameSync(join(source, "src/commands/XAN"), join(source, "src/commands/xan"));
    symlinkSync("../xan/input.ts", join(source, "src/commands/neighbor/link.ts"));
    assert.throws(() => sandbox(source), /fixture source must be regular and not a link/);
  } finally {
    if (directory) rmSync(directory, { recursive: true, force: true });
    rmSync(source, { recursive: true, force: true });
  }
});

test("copied writer fixtures retain public canonical identity and refuse a missing peer", { timeout: 30_000 }, () => {
  const directory = sandbox();
  try {
    const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
      import assert from "node:assert/strict";
      import { MemoryFileSystem } from "./src/fs/memory/index.ts";
      import * as canonical from "poe-code/safe-fs";
      assert.equal(MemoryFileSystem, canonical.MemoryFileSystem);
      console.log(import.meta.resolve("poe-code/safe-fs"));
    `], { cwd: directory, env: childEnv, encoding: "utf8", timeout: 20_000, maxBuffer: 1024 * 1024 });
    assert.equal(child.error, undefined);
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout.trim(), import.meta.resolve("poe-code/safe-fs"));
    rmSync(join(directory, "node_modules/poe-code"));
    const refused = spawnSync(process.execPath, ["--input-type=module", "-e", 'await import("poe-code/safe-fs");'], {
      cwd: directory, env: childEnv, encoding: "utf8", timeout: 5_000, maxBuffer: 1024 * 1024,
    });
    assert.equal(refused.error, undefined);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /ERR_MODULE_NOT_FOUND/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
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
