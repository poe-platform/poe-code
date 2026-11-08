import assert from "node:assert/strict";
import test from "node:test";
import { backupName } from "../../../src/commands/diff-patch/patch-gnu-paths.js";
import { Budget, type DiffPatchOptions } from "../../../src/commands/diff-patch/shared.js";
import { type CommandContext } from "../../../src/contracts/index.js";
import { filesystem } from "./helpers.js";

async function budget(names: readonly string[], options: DiffPatchOptions = {}) {
  const backing = await filesystem();
  const context: CommandContext = {
    command: "patch", args: [], cwd: "/work", env: {}, signal: new AbortController().signal,
    stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} },
    fs: new Proxy(backing, {
      get(target, property) {
        if (property === "readdir") return async () => names.map(name => ({ name, type: "file" as const }));
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }),
  };
  return new Budget(context, options);
}

for (const options of [{}, { maxOutputBytes: 32 }]) {
  test(`numbered backups accept long versions with independent limits: ${JSON.stringify(options)}`, async () => {
    const version = "9".repeat(4097);
    assert.equal(await backupName("/work/target", await budget([`target.~${version}~`], options)),
      `/work/target.~1${"0".repeat(4097)}~`);
  });
}

test("numbered backup scanning honors an explicit work limit", async () => {
  await assert.rejects(backupName("/work/target", await budget([`target.~${"9".repeat(4097)}~`], { maxWork: 1000 })), /work limit exceeded/);
});

test("numbered backups compare decimal values and ignore invalid versions", async () => {
  assert.equal(await backupName("/work/target", await budget(["target.~9~", "target.~10~", "target.~02~", "target.~abc~"])), "/work/target.~11~");
});
