import assert from "node:assert/strict";
import test from "node:test";
import { fixture, run } from "./helpers.js";

for (const [command, flags] of [["readlink", ["-f"]], ["realpath", []], ["realpath", ["-E"]]] as const) {
  test(`${command} ${flags.join(" ")} resolves dangling symlink chains`, async () => {
    const fs = await fixture({ "sub/present": "content" });
    await fs.symlink("sub/missing.txt", "/work/link1");
    await fs.symlink("link1", "/work/link2");
    await fs.symlink("/work/link2", "/work/absolute");
    for (const operand of ["link1", "link1/", "link2", "absolute"]) {
      const result = await run(command, [...flags, operand], { fs });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "/work/sub/missing.txt\n");
    }
    await fs.symlink("absent/missing", "/work/bad");
    await fs.symlink("cycle", "/work/cycle");
    for (const operand of ["bad", "cycle", "sub/present/child", "link1/.."])
      assert.equal((await run(command, [...flags, operand], { fs })).exitCode, 1, operand);
    assert.equal((await run(command, ["-e", "link1"], { fs })).exitCode, 1);
  });
}
