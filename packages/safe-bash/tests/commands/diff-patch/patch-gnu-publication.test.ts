import assert from "node:assert/strict";
import test from "node:test";
import { isFsError, type FileSystem } from "../../../src/contracts/index.js";
import { contents, filesystem, replacement, run } from "./helpers.js";

const twoHunks = replacement + "@@ -3 +3 @@ function\n-tail\n+TAIL\n";

async function namespace(fs: FileSystem) {
  const files: Record<string, string> = {};
  const directories: string[] = [];
  const visit = async (relative: string): Promise<void> => {
    for (const entry of await fs.readdir(`/work/${relative}`)) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.type === "directory") { directories.push(path); await visit(path); }
      else if (entry.type === "file") files[path] = await contents(fs, path);
      else throw new Error(`unexpected entry ${path}`);
    }
  };
  let rootExists = true;
  try { await visit(""); }
  catch (error) { if (!isFsError(error, "ENOENT")) throw error; rootExists = false; }
  return { files, directories: directories.sort(), rootExists };
}

test("noninteractive default explicitly chooses batch reversal, not force", async () => {
  const actual = await run("patch", [], { files: { target: "new\n" }, input: replacement });
  assert.match(actual.stdout, /Assuming -R/u);
});

for (const input of [twoHunks, replacement + replacement.replaceAll("target", "missing"), replacement + "--- missing\n+++ missing\n@@ -1 +1 @@\n-old\n"]) {
  test(`--atomic paired control retains complete namespace: ${JSON.stringify(input)}`, async () => {
    const fs = await filesystem({ target: "old\nkeep\nwrong\n", "target.orig": "existing backup\n", "target.rej": "existing reject\n" });
    const before = await namespace(fs);
    const actual = await run("patch", ["--atomic"], { fs, input });
    assert.notEqual(actual.exitCode, 0);
    assert.deepEqual(await namespace(fs), before);
  });
}

for (const atomic of [false, true]) for (const suffix of [".orig", ".rej"]) for (const kind of ["symlink", "hardlink"]) {
  test(`publication safety ${atomic ? "atomic" : "default"}: ${suffix} ${kind}`, async () => {
    const fs = await filesystem({ target: "old\nkeep\nwrong\n", protected: "PROTECTED\n" });
    if (kind === "symlink") await fs.symlink("protected", `/work/target${suffix}`);
    else await fs.link("/work/protected", `/work/target${suffix}`);
    const result = await run("patch", atomic ? ["--atomic"] : [], { fs, input: twoHunks });
    assert.notEqual(result.exitCode, 0);
    assert.equal(await contents(fs, "protected"), "PROTECTED\n");
    assert.equal(await contents(fs, "target"), "old\nkeep\nwrong\n");
  });
}
