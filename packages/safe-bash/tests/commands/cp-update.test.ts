import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./helpers.js";
import { Shell } from "../../src/shell/index.js";
import { agentCommands } from "../../src/plugins/index.js";

for (const option of ["-u", "--update"]) {
  for (const destinationTime of [undefined, 1000, 2000, 3000]) {
    test(`cp ${option} updates a destination with timestamp ${destinationTime}`, async () => {
      const fs = await fixture({ source: "new", ...(destinationTime === undefined ? {} : { output: "old" }) });
      await fs.utimes("/work/source", 2000, 2000);
      if (destinationTime !== undefined) await fs.utimes("/work/output", destinationTime, destinationTime);
      const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
      const result = await shell.exec(`cp ${option} -v source output`);
      const copied = destinationTime === undefined || destinationTime < 2000;
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, copied ? "'source' -> 'output'\n" : "");
      assert.equal(new TextDecoder().decode(await fs.readFile("/work/output")), copied ? "new" : "old");
      if (!copied) assert.equal((await fs.stat("/work/output")).mtimeMs, destinationTime);
    });
  }
}

test("cp update traverses newer directories and compares each leaf before backups or replacement", async () => {
  const fs = await fixture({ "source/older": "new", "source/newer": "new", "source/missing": "new", "target/older": "old", "target/newer": "old" });
  for (const path of ["source", "source/older", "source/newer", "source/missing"]) await fs.utimes(`/work/${path}`, 2000, 2000);
  await fs.utimes("/work/target", 3000, 3000);
  await fs.utimes("/work/target/older", 1000, 1000);
  await fs.utimes("/work/target/newer", 3000, 3000);
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  const result = await shell.exec("cp -RuTb --remove-destination source target");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "");
  for (const path of ["older", "missing", "newer"]) {
    assert.equal(new TextDecoder().decode(await fs.readFile(`/work/target/${path}`)), path === "newer" ? "old" : "new");
  }
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/target/older~")), "old");
  await assert.rejects(fs.stat("/work/target/newer~"), { code: "ENOENT" });
});

test("cp update follows destination symlink timestamps and respects no-clobber", async () => {
  const fs = await fixture({ source: "new", referent: "old", output: "old" });
  await fs.utimes("/work/source", 2000, 2000);
  await fs.utimes("/work/referent", 3000, 3000);
  await fs.utimes("/work/output", 1000, 1000);
  await fs.symlink("referent", "/work/link");
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  for (const command of ["cp -u source link", "cp -un source output"]) {
    const result = await shell.exec(command);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "");
  }
  assert.equal((await fs.lstat("/work/link")).type, "symlink");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/referent")), "old");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/output")), "old");
});
