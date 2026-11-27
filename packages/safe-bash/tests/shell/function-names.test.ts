import assert from "node:assert/strict";
import test from "node:test";
import { agentCommands } from "../../src/plugins/index.js";
import { setup } from "./helpers.js";

for (const name of ["f-g", "a.b", "ns::fn", "my-func"]) {
  for (const definition of [`${name}()`, `function ${name}`, `function ${name}()`]) {
    test(`accepts function name in ${definition}`, async context => {
      const { shell } = setup();
      context.after(() => shell.dispose());
      const result = await shell.exec(`${definition} { say ok; }; ${name}`);
      assert.equal(result.stdout, "ok\n");
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    });
  }
}

test("executes mixed Bash function-name forms with agent commands", async context => {
  const { shell } = setup({ cwd: "/work" });
  shell.use(agentCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec("f-g() { echo 6; }; f-g; ns::fn() { echo 8; }; ns::fn; function my-func { echo 9; }; my-func");
  assert.equal(result.stdout, "6\n8\n9\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

for (const name of ["'f-g'", '"f-g"', "$name"]) {
  for (const definition of [`${name}()`, `function ${name}`]) {
    test(`rejects quoted or expanded function name in ${definition}`, async context => {
      const { shell } = setup();
      context.after(() => shell.dispose());
      const result = await shell.exec(`${definition} { say unreachable; }`);
      assert.equal(result.stdout, "");
      assert.equal(result.exitCode, 2);
      assert.ok(result.stderr.includes("Invalid function name"));
    });
  }
}
