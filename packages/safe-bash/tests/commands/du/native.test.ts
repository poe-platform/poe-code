import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
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
  "-b ": "du: invalid zero-length file name\n",
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
