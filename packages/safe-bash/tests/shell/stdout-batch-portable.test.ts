import assert from "node:assert/strict";
import { test } from "node:test";
import { printfCommand } from "../../src/commands/basic.js";
import { ShellLimitError } from "../../src/shell/types.js";
import { setup } from "./helpers.js";

for (const text of ["ascii", "é😀", "\ud800"]) {
  for (const withinBudget of [true, false]) {
    test(`discarded loop output counts UTF-8 without global Buffer: ${JSON.stringify(text)}, within budget=${withinBudget}`, async () => {
      const expectedBytes = new TextEncoder().encode(text.repeat(3)).byteLength;
      const { shell, commands } = setup({ limits: { maxOutputBytes: expectedBytes - (withinBudget ? 0 : 1) } });
      commands.register(printfCommand);
      const saved = Object.getOwnPropertyDescriptor(globalThis, "Buffer");
      try {
        Reflect.deleteProperty(globalThis, "Buffer");
        const execution = shell.exec(`for ((i=0; i<3; i++)); do printf '%s' '${text}'; done >/dev/null`);
        if (withinBudget) {
          const result = await execution;
          assert.equal(result.stdout, "");
          assert.equal(result.stderr, "");
          assert.equal(result.exitCode, 0);
        } else {
          await assert.rejects(execution, error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
        }
      } finally {
        if (saved) Object.defineProperty(globalThis, "Buffer", saved);
        await shell.dispose();
      }
    });
  }
}
