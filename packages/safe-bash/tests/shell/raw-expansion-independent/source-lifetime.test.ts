import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { Shell } from "../../../src/shell/shell.js";
import { ShellLimitError } from "../../../src/shell/types.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { getCommandArguments } from "../../../src/contracts/index.js";
import { shellValueBytes } from "../../../src/contracts/value.js";

for (const exhausted of [false, true]) {
  test(`deferred eval function retains raw literal after source scope closes, source quota exhausted=${exhausted}`, async () => {
    const fs = new MemoryFileSystem();
    const script = "raw=$'\\200\\377'; eval \"later(){ capture '$raw'; }\"; unset raw; later\n";
    const entry = "sh /review.sh";
    const sourceBytes = Buffer.byteLength(entry) + Buffer.byteLength(script) + Buffer.byteLength("later(){ capture ''; }") + 2;
    await fs.writeFile("/review.sh", Buffer.from(script));
    const captured: string[] = [];
    const shell = new Shell({ fs, env: { LC_ALL: "C" } });
    shell.commands.register({ name: "capture", async execute(context) {
      await setImmediate();
      captured.push(Buffer.from(shellValueBytes(getCommandArguments(context).values[0]!)).toString("hex"));
      return { exitCode: 0 };
    } });
    try {
      const execution = shell.exec(entry, { limits: { maxSourceBytes: sourceBytes - Number(exhausted) } });
      if (exhausted) await assert.rejects(execution, error => error instanceof ShellLimitError && error.limit === "maxSourceBytes");
      else assert.equal((await execution).exitCode, 0);
      assert.deepEqual(captured, exhausted ? [] : ["80ff"]);
    } finally { await shell.dispose(); }
  });
}
