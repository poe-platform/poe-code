import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { yieldTurn } from "safe-bash-contracts/yield";
import type { CommandContext } from "safe-bash-contracts";
import { createCodec, loadRawCodecFactory } from "./codec-loader.js";
import type { RawCodecModule } from "./native/types.js";
import { planOperands } from "./files.js";
import { createOptionsParser, formats } from "./options.js";
import { runOperand } from "./operand.js";
import { DecodedBudget, transform } from "./stream.js";

for (const format of ["bzip2", "xz", "zstd"] as const) {
  const parseOptions = createOptionsParser([{ ...formats[format], format, names: [format] }]);
  test(`${format} cleanup works without setImmediate`, async context => {
    const immediate = Object.getOwnPropertyDescriptor(globalThis, "setImmediate")!;
    Reflect.deleteProperty(globalThis, "setImmediate");
    context.after(() => Object.defineProperty(globalThis, "setImmediate", immediate));

    await context.test("destroys once and detaches the released heap", async () => {
      const factory = await loadRawCodecFactory(format);
      let module!: RawCodecModule;
      let destroyed = 0;
      const codec = await createCodec({ format, level: 1, decompress: false }, new AbortController().signal, wasi => {
        module = factory(wasi);
        const destroy = module.bridge_destroy;
        module.bridge_destroy = () => { destroyed++; destroy(); assert.equal(module.bridge_used(), 0); };
        return module;
      });
      codec.close();
      codec.close();
      assert.equal(destroyed, 1);
      await yieldTurn();
      assert.equal(module.memory.buffer.byteLength, 0);
    });

    for (const file of [false, true]) {
      await context.test(`${file ? "file" : "stdout"} operand preserves exact bytes`, async () => {
        const plain = Uint8Array.of(0, 255, 10, 128, 65, 0);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input", plain);
        const chunks: Uint8Array[] = [];
        const options = parseOptions(format, file ? ["-k", "/input"] : ["-c"]);
        const command: CommandContext = {
          command: format, args: [], cwd: "/", env: {}, fs,
          signal: new AbortController().signal,
          stdin: (async function* () { yield plain; })(),
          stdout: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } },
          stderr: { write() { assert.fail("unexpected diagnostic"); } },
        };
        const [plan] = await planOperands(command, options);
        assert.ok(plan);
        await runOperand(command, plan, options, new DecodedBudget());
        const compressed = file ? await fs.readFile(plan.destination!) : Buffer.concat(chunks);
        const decoded: Uint8Array[] = [];
        await transform((async function* () { yield compressed; })(), async output => {
          for await (const bytes of output) decoded.push(new Uint8Array(bytes));
        }, parseOptions(format, ["-dc"]), command.signal);
        assert.deepEqual(Buffer.concat(decoded), Buffer.from(plain));
        assert.deepEqual(await fs.readFile("/input"), plain);
      });
    }
  });
}
