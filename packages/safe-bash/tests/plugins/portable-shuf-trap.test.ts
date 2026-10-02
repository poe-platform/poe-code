import assert from "node:assert/strict";
import test from "node:test";
import { portableRuntime } from "../helpers/portable-runtime.js";

test("shuf entropy, explicit traps, and node path contracts work without Node globals", async context => {
  const { api } = await portableRuntime(`
    import { Shell as BaseShell } from "./packages/safe-bash/src/shell/index.ts";
    import { MemoryFileSystem } from "./packages/safe-bash/src/fs/memory/index.ts";
    import { shufCommands } from "./packages/safe-bash/src/core.ts";
    import { basicCommands } from "./packages/safe-bash/src/commands/basic.ts";
    import { trapExtension } from "./packages/safe-bash/src/shell/extensions/trap/index.ts";
    import { posixPath } from "./packages/safe-bash/src/contracts/node.ts";
    import { posixPath as otherPath } from "./packages/safe-bash/src/contracts/node-path.ts";
    if (posixPath !== otherPath || posixPath.resolve("/workspace", "../input") !== "/input") {
      throw new Error("portable node path contracts disagree");
    }
    export class Shell extends BaseShell {
      constructor() {
        super({ fs: new MemoryFileSystem(), extensions: [trapExtension()] });
        for (const command of basicCommands()) this.register(command);
        this.use(shufCommands());
      }
    }
  `);
  const shell = new api.Shell();
  context.after(() => shell.dispose());
  const shuffled = await shell.exec("shuf -i 1-100");
  assert.equal(shuffled.exitCode, 0, shuffled.stderr);
  assert.deepEqual(shuffled.stdout.trim().split("\n").map(Number).sort((a, b) => a - b), Array.from({ length: 100 }, (_, i) => i + 1));
  const sampled = await shell.exec("shuf -r -i 1-3 -n 40");
  assert.equal(sampled.exitCode, 0, sampled.stderr);
  const samples = sampled.stdout.trim().split("\n");
  assert.equal(samples.length, 40);
  assert.ok(samples.every(value => ["1", "2", "3"].includes(value)));
  const trapped = await shell.exec("trap 'echo portable-exit' EXIT; echo body");
  assert.equal(trapped.exitCode, 0, trapped.stderr);
  assert.equal(trapped.stdout, "body\nportable-exit\n");
  const signals = await shell.exec("trap -l");
  assert.equal(signals.exitCode, 0, signals.stderr);
  assert.ok(signals.stdout.includes("SIGUSR1"));
  assert.ok(signals.stdout.includes("SIGTERM"));
});
