import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { Shell } from "../../src/shell/shell.js";
import { structuredCommands } from "../../src/commands/structured/index.js";
import { textProgramCommands } from "../../src/commands/text-programs/index.js";
import { standardCommands } from "../../src/commands/index.js";

async function completedRequest(source: string, captureState: boolean, memory: boolean): Promise<WeakRef<object>[]> {
  const backing = createMemoryFileSystem();
  const fs = memory ? backing : new Proxy(backing, {});
  const controller = new AbortController();
  const shell = new Shell({ fs, env: { TENANT_SECRET: "synthetic-tenant-secret" } })
    .use(standardCommands()).use(structuredCommands()).use(textProgramCommands());
  let result = await shell.exec(source, { signal: controller.signal, ...(captureState ? { onState() {} } : {}) });
  assert.equal(result.exitCode, 0, result.stderr);
  await shell.dispose();
  const refs = [new WeakRef(fs), new WeakRef(controller.signal), new WeakRef(result)];
  result = undefined!;
  return refs;
}

for (const source of [
  "echo $TENANT_SECRET",
  "echo one | cat",
  "mkdir /d1",
  "mkdir /d1 | head -n 1",
  "printf '{}\\n' | jq --arg secret synthetic-secret .",
  "printf 'secret\\n' | awk '{print}'",
]) {
  for (const [captureState, memory] of [[false, false], [true, false], [false, true]] as const) {
    test(`completed request releases host resources: ${source}, state=${captureState}, memory=${memory}`, { skip: !globalThis.gc }, async () => {
      const refs = await completedRequest(source, captureState, memory);
      for (let attempt = 0; attempt < 2; attempt++) {
        await new Promise<void>(resolve => setImmediate(resolve));
        globalThis.gc!();
      }
      assert.deepEqual(refs.map(ref => ref.deref() === undefined), [true, true, true]);
    });
  }
}
