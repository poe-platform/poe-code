import assert from "node:assert/strict";
import test from "node:test";
import { contents, filesystem, replacement, run } from "./helpers.js";

for (const atomic of [false, true]) {
  for (const suffix of ["orig", "rej"]) {
    test(`followup dry-run mismatch never authorizes ${suffix}, atomic=${atomic}`, async () => {
      const fs = await filesystem({ target: "wrong\n", sentinel: "untouched\n" });
      await fs.symlink("sentinel", `/work/target.${suffix}`);
      const result = await run("patch", ["--dry-run", ...(atomic ? ["--atomic"] : [])], { fs, input: replacement });
      assert.equal(result.exitCode, 1, result.stderr);
      assert.equal(await contents(fs, "target"), "wrong\n");
      assert.equal(await contents(fs, "sentinel"), "untouched\n");
      assert.equal(await fs.readlink(`/work/target.${suffix}`), "sentinel");
    });
  }
}

for (const kind of ["symlink", "hardlink"] as const) {
  test(`followup unused header ${kind} is not an authorized target`, async () => {
    const fs = await filesystem({ target: "old\n", sentinel: "untouched\n" });
    if (kind === "symlink") await fs.symlink("sentinel", "/work/unused-long-name");
    else await fs.link("/work/sentinel", "/work/unused-long-name");
    const result = await run("patch", [], { fs, input: replacement.replace("+++ target", "+++ unused-long-name") });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(await contents(fs, "target"), "new\n");
    assert.equal(await contents(fs, "sentinel"), "untouched\n");
  });
}

test("followup an actual reject may use an unselected ordinary header name", async () => {
  const fs = await filesystem({ target: "wrong\n", "unused-long-name": "unused\n" });
  const input = replacement.replace("+++ target", "+++ unused-long-name");
  const result = await run("patch", ["-r", "unused-long-name"], { fs, input });
  assert.equal(result.exitCode, 1, result.stderr);
  assert.equal(await contents(fs, "target"), "wrong\n");
  assert.equal(await contents(fs, "unused-long-name"), input);
});
