import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { Shell, MemoryFileSystem, FsError, standardCommands } from "../../../../src/index.js";

const history = JSON.parse(gunzipSync(Buffer.from(readFileSync(new URL("../observations-01.json.gz.base64", import.meta.url), "utf8"), "base64")).toString()) as {
  native: { id: string; script: string; observed: { stdout: string; stderr: string } }[];
};

for (const item of history.native) test(`preserved native mapping ${item.id}${item.id === "C28" ? " explicit legacy divergence" : ""}`, async () => {
  const fs = new MemoryFileSystem();
  for (const directory of ["work/target", "work/onlylocal", "work/home", "work/rel/target", "p1/target", "p2/target", "p1/denied", "p2/denied", "p2/problem"]) {
    await fs.mkdir(`/fixture/${directory}`, { recursive: true });
  }
  await fs.writeFile("/fixture/p1/problem", new TextEncoder().encode("candidate file"));
  await fs.writeFile("/fixture/work/localfile", new TextEncoder().encode("fallback file"));
  await fs.symlink("p1", "/fixture/alias");
  const access = fs.access.bind(fs);
  fs.access = async (path, mode, options) => {
    if (path === "/fixture/p1/denied") throw new FsError("EACCES", { path });
    return access(path, mode, options);
  };
  const shell = new Shell({ fs, cwd: "/fixture/work", env: { ROOT: "/fixture", HOME: "/fixture/work/home", OLDPWD: "/fixture", PATH: "" } }).use(standardCommands());
  try {
    const result = await shell.exec(item.script + '\nstatus=$?; printf "status=%s\\nPWD=%s\\nOLDPWD=%s\\n" "$status" "$PWD" "$OLDPWD"');
    assert.equal(result.exitCode, 0, "the final snapshot command, not the cd status");
    if (item.id === "C28") {
      assert.equal(item.observed.stdout, "status=1\nPWD=/fixture/work\nOLDPWD=/fixture\n");
      assert.equal(result.stdout, "status=0\nPWD=/fixture/work\nOLDPWD=/fixture/work\n");
      assert.equal(result.stderr, "");
    } else {
      assert.equal(result.stdout, item.observed.stdout);
      const diagnostic = (value: string) => value.replace(/^(?:cd-prerequisite-probe|shell): line 1: /, "");
      assert.equal(diagnostic(result.stderr), diagnostic(item.observed.stderr));
    }
  } finally { await shell.dispose(); }
});
