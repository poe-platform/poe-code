import assert from "node:assert/strict";
import test from "node:test";
import { ShellInput } from "../../src/shell/input.js";
import { Budget, defaultLimits } from "../../src/shell/runtime.js";
import { setup } from "./helpers.js";
import { basicCommands } from "../../src/commands/basic.js";
test("mapfile ASCII records do not require Buffer", async () => {
  const budget = new Budget(defaultLimits);
  for (const length of [65, 80, 512]) {
    const bytes = new TextEncoder().encode("!" + "x".repeat(length) + "\n");
    const input = new ShellInput(
      {
        async *[Symbol.asyncIterator]() {
          yield bytes;
        }
      },
      budget
    );
    await input.read(1, budget.signal);
    const saved = globalThis.Buffer;
    try {
      globalThis.Buffer = undefined as unknown as typeof Buffer;
      assert.equal(input.tryMapfileRecordSync(10, true)?.value, "x".repeat(length));
    } finally {
      globalThis.Buffer = saved;
      await input.close();
    }
  }
  budget.close();
  budget.values.close();
});

test("mapfile command consumes medium records without global Buffer", async () => {
  const { shell, commands } = setup();
  for (const command of basicCommands()) commands.register(command);
  const saved = globalThis.Buffer;
  try {
    globalThis.Buffer = undefined as unknown as typeof Buffer;
    const result = await shell.exec('mapfile -t arr; printf "%s" "${arr[0]}"', {
      stdin: "x".repeat(80) + "\n"
    });
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "x".repeat(80));
  } finally {
    globalThis.Buffer = saved;
    await shell.dispose();
  }
});
