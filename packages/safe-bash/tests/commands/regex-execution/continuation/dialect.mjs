import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const base = fileURLToPath(new URL("./", import.meta.url));
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const baselinePath = resolve(root, "tests/stress/regex-execution/production-continuation-review/snapshots/baseline/dist/index.js");
const baseline = await import(pathToFileURL(baselinePath).href);
const candidate = await import(new URL("../../../../dist/index.js", import.meta.url).href);
const cases = [
  { name: "brace alternatives", glob: "alpha.{ts,js}", files: ["alpha.ts", "alpha.js", "beta.ts"] },
  { name: "nested brace alternatives", glob: "{alpha,{beta,gamma}}", files: ["alpha", "beta", "gamma"] },
  { name: "unclosed CLI class", glob: "alpha[", files: ["alpha[", "alpha"] },
  { name: "invalid class range", glob: "[z-a]", files: ["alpha"] },
  { name: "escaped literal star", glob: "alpha\\*", files: ["alpha*", "alpha"] },
  { name: "ASCII class", glob: "[a-c].ts", files: ["a.ts", "d.ts"] },
  { name: "POSIX class spelling", glob: "[[:digit:]]", files: ["1", "a"] },
  { name: "globstar crosses newline directory", glob: "**/alpha", files: ["dir\n/alpha", "sub/alpha", "alpha"] },
  { name: "single star permits newline", glob: "*alpha", files: ["line\nalpha", "alpha"] },
  { name: "Unicode single character", glob: "?.ts", files: ["🙂.ts", "ab.ts"] },
];
const evidence = { node: process.version, platform: process.platform, nativeVersion: spawnSync("rg", ["--version"], { encoding: "utf8", timeout: 3000 }).stdout, profile: "native rg --no-config --sort path --no-ignore-parent --no-require-git in isolated repository-local fixture; virtual equivalent filters and byte-sorted traversal", cases: [], baselineSha256: createHash("sha256").update(await readFile(baselinePath)).digest("hex") };
await writeFile(resolve(base, "dialect-evidence.json"), JSON.stringify({ claimed: true }) + "\n", { flag: "wx" });
await mkdir(resolve(base, "artifacts/native"), { recursive: true });
const quote = source => `'${source.replaceAll("'", "'\\''")}'`;
const triple = result => ({ code: result.exitCode, stdout: Buffer.from(result.stdoutBytes).toString("base64"), stderr: Buffer.from(result.stderrBytes).toString("base64") });
async function virtual(api, fixture) {
  const fs = new api.MemoryFileSystem();
  await fs.mkdir("/work");
  for (const file of fixture.files) {
    const path = `/work/${file}`;
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(path, Buffer.from("hit\n"));
  }
  const shell = new api.Shell({ fs, cwd: "/work" }).use(api.agentCommands());
  try { return triple(await shell.exec(`rg --files --no-ignore-parent --no-require-git -g ${quote(fixture.glob)} .`)); }
  finally { await shell.dispose(); }
}
try {
  for (const fixture of cases) {
    const directory = await mkdtemp(resolve(base, "artifacts/native/dialect-"));
    for (const file of fixture.files) {
      const path = resolve(directory, file);
      assert.ok(path.startsWith(directory + "/"));
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, "hit\n");
    }
    const native = spawnSync("rg", ["--no-config", "--sort", "path", "--files", "--no-ignore-parent", "--no-require-git", "-g", fixture.glob, "."], { cwd: directory, timeout: 3000, killSignal: "SIGKILL", maxBuffer: 65536, env: { PATH: process.env.PATH, LC_ALL: "C", LANG: "C" } });
    assert.equal(native.signal, null);
    const before = await virtual(baseline, fixture);
    const after = await virtual(candidate, fixture);
    const oracle = { code: native.status, stdout: native.stdout.toString("base64"), stderr: native.stderr.toString("base64") };
    evidence.cases.push({ ...fixture, before, after, native: oracle, unchanged: JSON.stringify(before) === JSON.stringify(after), nativeExact: JSON.stringify(after) === JSON.stringify(oracle) });
    assert.deepEqual(after, before, fixture.name);
  }
  console.log(JSON.stringify({ cases: evidence.cases.length, unchanged: evidence.cases.filter(item => item.unchanged).length, nativeExact: evidence.cases.filter(item => item.nativeExact).length }));
} finally { await writeFile(resolve(base, "dialect-evidence.json"), JSON.stringify(evidence, null, 2) + "\n"); }
