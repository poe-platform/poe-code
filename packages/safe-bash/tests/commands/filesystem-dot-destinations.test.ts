import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./helpers.js";
import { Shell } from "../../src/shell/index.js";
import { agentCommands } from "../../src/plugins/index.js";

test("copy, move and implicit symlink destinations use the current directory", async () => {
  const fs = await fixture();
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  const result = await shell.exec("mkdir d; touch d/a d/b d/c; cp d/a .; echo $?; mv d/b .; echo $?; ln -s d/c; echo $?; ls");
  assert.equal(result.stdout, "0\n0\n0\na\nb\nc\nd\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
  assert.equal(await fs.readlink("/work/c"), "d/c");
  await assert.rejects(fs.stat("/work/d/b"), { code: "ENOENT" });
});

for (const command of ["cp", "mv", "ln", "ln -s", "install"]) {
  for (const destination of [".", "./", "..", "../", "d/.", "d/..", "d/../"]) {
    test(`${command} recognizes directory destination ${destination}`, async () => {
      const fs = await fixture({ "source/file": "contents", "d/keep": "retained" });
      const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
      const result = await shell.exec(`${command} /work/source/file ${destination}`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      const target = destination.startsWith("..") ? "/file" : destination === "d/." ? "/work/d/file" : "/work/file";
      assert.equal(new TextDecoder().decode(await fs.readFile(target)), "contents");
      assert.equal(new TextDecoder().decode(await fs.readFile("/work/d/keep")), "retained");
    });
  }
}

for (const command of ["cp -t . source/file", "cp -r source/. .", "ln source/file"]) {
  test(command, async () => {
    const fs = await fixture({ "source/file": "contents" });
    const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
    const result = await shell.exec(command);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/file")), "contents");
  });
}

for (const destination of ["missing/..", "file/.", "file/.."]) {
  test(`invalid directory destination ${destination} preserves files`, async () => {
    const fs = await fixture({ "source/file": "contents", file: "retained" });
    const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
    const result = await shell.exec(`cp source/file ${destination}`);
    assert.equal(result.exitCode, 1);
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/file")), "retained");
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/source/file")), "contents");
  });
}
