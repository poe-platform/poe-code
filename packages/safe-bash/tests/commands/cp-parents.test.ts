import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { agentCommands } from "../../src/plugins/index.js";
import { fixture } from "./helpers.js";

test("cp --parents retains the selected file's directory structure", async context => {
  const fs = await fixture();
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec("mkdir -p a/b d; echo 1 > a/b/f; cp --parents a/b/f d; echo $?; find d | sort");
  assert.equal(result.stdout, "0\nd\nd/a\nd/a/b\nd/a/b/f\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/d/a/b/f")), "1\n");
});
