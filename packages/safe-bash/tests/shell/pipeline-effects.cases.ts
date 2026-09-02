import assert from "node:assert/strict";
import { test } from "node:test";
import { writeText } from "../../src/contracts/index.js";
import { setup } from "./helpers.js";

test("downstream exit does not interrupt an upstream asynchronous effect", { timeout: 3000 }, async () => {
  const { shell, commands, fs } = setup();
  let finish!: () => void;
  const downstreamDone = new Promise<void>((resolve) => { finish = resolve; });
  commands.register({ name: "producer", async execute({ signal, fs }) {
    await downstreamDone;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(signal.aborted, false);
    await fs.writeFile("/after", new Uint8Array([65]), { signal });
    return { exitCode: 7 };
  } });
  commands.register({ name: "consumer", execute() { finish(); return { exitCode: 0 }; } });
  assert.equal((await shell.exec("set -o pipefail; producer | consumer", { signal: AbortSignal.timeout(2000) })).exitCode, 7);
  assert.deepEqual(await fs.readFile("/after"), new Uint8Array([65]));
});

test("a producer that writes a broken pipe cannot continue later effects", { timeout: 3000 }, async () => {
  const { shell, commands, fs } = setup({ limits: { pipeHighWaterMark: 1 } });
  commands.register({ name: "producer", async execute({ stdout }) {
    while (true) await writeText(stdout, "chunk");
  } });
  const result = await shell.exec("set -o pipefail; { producer; : >after; } | true", { signal: AbortSignal.timeout(2000) });
  assert.equal(result.exitCode, 141);
  assert.deepEqual(await fs.readdir("/"), []);
});
