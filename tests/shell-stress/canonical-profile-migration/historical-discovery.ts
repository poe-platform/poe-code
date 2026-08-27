import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";
import { discoveryFixCases, discoveryFixFiles, discoveryFixFileText } from "../../shell/invocation-discovery-fixes-cases.js";
import { discoveryProfile } from "./discovery-profile.js";

const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
const profile = discoveryProfile("historical-3.2");
for (const row of profile.observations) test(`${profile.name}/${row.mode}/${row.name}`, async () => {
  assert.equal(row.source, discoveryFixCases.find(fixture => fixture.name === row.name)?.source);
  const fs = new MemoryFileSystem();
  for (const file of discoveryFixFiles) {
    const path = `${row.cwd}/${file}`;
    await fs.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
    await fs.writeFile(path, Buffer.from(discoveryFixFileText), { mode: 0o755 });
  }
  await fs.symlink("closuretool", `${row.cwd}/tools/linktool`);
  const forbidden = new Set(["readFile", "readFileStream", "writeFile", "writeFileStream", "appendFile", "mkdir", "rm", "rmdir", "rename", "copyFile", "symlink", "link", "chmod", "utimes"]);
  const guarded = new Proxy(fs, { get(target, key) {
    if (forbidden.has(String(key))) return () => { assert.fail(`discovery must not perform ${String(key)}`); };
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const shell = new Shell({ fs: guarded, cwd: row.cwd, env: { PATH: "", LC_ALL: "C", LANG: "C", HOME: row.cwd, TZ: "UTC" } });
  const result = await shell.exec(row.mode === "bash" ? row.source : `sh -c ${quote(row.source)} shell`);
  assert.deepEqual({ stdoutHex: Buffer.from(result.stdoutBytes).toString("hex"), stderrHex: Buffer.from(result.stderrBytes).toString("hex"), status: result.exitCode }, row.result);
});
