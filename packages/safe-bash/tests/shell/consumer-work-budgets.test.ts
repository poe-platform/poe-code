import assert from "node:assert/strict";
import test from "node:test";
import { ShellLimitError } from "../../src/shell/index.js";
import { setup } from "./helpers.js";

const limits = { maxCommands: 10_000, maxLoopIterations: 10_000 };

test("consumer work budgets reject before a later mutation and allow another invocation", async (t) => {
  const { shell, fs, commands } = setup({ limits });
  t.after(() => shell.dispose());
  let completed = 0;
  commands.register({
    name: "completed",
    execute(context) {
      context.registerCleanup!(() => {
        completed++;
      });
      return { exitCode: 0 };
    }
  });

  await assert.rejects(
    shell.exec("while true; do completed; done; : > /after"),
    (error) => error instanceof ShellLimitError && error.limit === "maxCommands"
  );
  // The loop command and each condition also consume the command budget.
  assert.equal(completed, 4_999);
  await assert.rejects(fs.stat("/after"), (error) => error.code === "ENOENT");
  const settled = completed;
  assert.equal((await shell.exec("completed; : > /healthy")).exitCode, 0);
  assert.equal(completed, settled + 1);
  assert.equal((await fs.stat("/healthy")).size, 0);
});

test("consumer work budgets admit a thousand arithmetic loop iterations", async (t) => {
  const { shell, commands } = setup({ limits });
  t.after(() => shell.dispose());
  let completed = 0;
  commands.register({
    name: "completed",
    execute(context) {
      context.registerCleanup!(() => {
        completed++;
      });
      return { exitCode: 0 };
    }
  });

  assert.equal((await shell.exec("for ((i=0; i<1000; i++)); do completed; done")).exitCode, 0);
  assert.equal(completed, 1_000);
  assert.equal((await shell.exec(":")).exitCode, 0);
});
