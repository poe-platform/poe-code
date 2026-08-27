import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, truncate } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createRealFileSystem } from "../../../src/fs/real/index.js";
import { seed, shellRun } from "./helpers.js";

interface NativeCase { name: string; args: string[]; env: Record<string, string>; status: number; stdout: string; stderr: string }
const profile = JSON.parse(await readFile(new URL("native-profile.json", import.meta.url), "utf8")) as {
  binarySha256: string; sizes: number[]; results: NativeCase[];
};
const fs = createMemoryFileSystem(); await seed(fs);
await fs.link!("/tree/a", "/alias"); await fs.symlink!("tree", "/link"); await fs.symlink!("absent", "/broken");
for (const size of profile.sizes) await fs.writeFile(`/size-${size}`, new Uint8Array(size));
const diagnosticProfile: Readonly<Record<string, string>> = {
  "tree:-as": "du: cannot combine --all and --summarize\n",
  "tree:-s -d1": "du: --summarize conflicts with --max-depth\n",
  "-b missing tree/a": "du: \"missing\": no such file or directory, lstat '/missing'\n",
  "-b ": "du: \"\": no such file or directory, lstat ''\n",
  "-b tree/a --unsupported": "du: unrecognized option '--unsupported'\n",
  "block:b": "du: invalid block size 'b'\n",
  "block:0": "du: invalid or unsafe block size '0'\n",
  "block:-1": "du: invalid block size '-1'\n",
  "block:1.5K": "du: invalid block size '1.5K'\n",
  "block:Q": "du: invalid or unsafe block size 'Q'\n",
  "block:1Q": "du: invalid or unsafe block size '1Q'\n",
};

for (const item of profile.results) {
  test(`GNU 9.7 captured profile: ${item.name}`, async () => {
    const result = await shellRun(fs, item.args, item.env);
    if (item.name === "-b tree tree") {
      assert.equal(item.stdout, "5\ttree/sub\n8\ttree\n");
      assert.equal(result.stdout, "5\ttree/sub\n8\ttree\n0\ttree/sub\n0\ttree\n");
      assert.equal(result.exitCode, 0); assert.equal(result.stderr, "");
    } else if (Object.hasOwn(item.env, "DU_BLOCK_SIZE") && ["bad", ""].includes(item.env.DU_BLOCK_SIZE!)) {
      assert.equal(item.status, 0); assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, ""); assert.match(result.stderr, /^du: invalid block size '(bad|)'\n$/u);
    } else {
      assert.equal(result.exitCode, item.status);
      assert.equal(result.stdout, item.stdout);
      if (item.stderr === "") assert.equal(result.stderr, "");
      else if (item.name === "tree:-s -d0") assert.equal(result.stderr, "");
      else {
        assert.ok(Object.hasOwn(diagnosticProfile, item.name), `classify native diagnostic: ${item.name}`);
        assert.equal(result.stderr, diagnosticProfile[item.name]);
      }
    }
  });
}

test("live pinned GNU 9.7 versus rooted Real allocation, hardlinks and sparse files", async context => {
  const oracle = fileURLToPath(new URL("../metadata-stress/.oracle/coreutils-9.7/src/du", import.meta.url));
  let bytes: Uint8Array;
  try { bytes = await readFile(oracle); }
  catch { context.skip("read-only pinned GNU du binary unavailable; no BSD substitution"); return; }
  assert.equal(createHash("sha256").update(bytes).digest("hex"), profile.binarySha256);
  const root = await mkdtemp(fileURLToPath(new URL(".native-oracle-", import.meta.url)));
  context.after(() => rm(root, { recursive: true, force: true }));
  const real = await createRealFileSystem({ root }); await seed(real);
  await real.link!("/tree/a", "/alias");
  await real.writeFile("/sparse", new Uint8Array()); await truncate(join(root, "sparse"), 1048576);
  await symlink("tree", join(root, "link")); await symlink("absent", join(root, "broken"));
  const cases = [
    ["tree"], ["-s", "tree"], ["-sc", "tree"], ["-sB1", "tree"], ["-sh", "tree"],
    ["-sk", "tree"], ["-sm", "tree"], ["-sBKB", "tree"], ["-a", "tree"], ["-ad1", "tree"],
    ["-b", "tree"], ["-bc", "tree/a", "alias"], ["-blc", "tree/a", "alias"],
    ["-B1", "sparse"], ["-b", "sparse"], ["-bc", "link", "broken"], ["-c", "link", "broken"], ["-b", "link/"],
  ];
  for (const args of cases) {
    const native = spawnSync(oracle, args, { cwd: root, env: { PATH: "/usr/bin:/bin", LC_ALL: "C" }, encoding: "utf8", timeout: 10000 });
    assert.equal(native.status, 0, native.stderr);
    const result = await shellRun(real, args);
    assert.equal(result.exitCode, native.status, result.stderr);
    assert.equal(result.stderr, native.stderr);
    assert.deepEqual(result.stdout.trimEnd().split("\n").sort(), native.stdout.trimEnd().split("\n").sort(), args.join(" "));
  }
  assert.equal(createHash("sha256").update(await readFile(oracle)).digest("hex"), profile.binarySha256);
});
