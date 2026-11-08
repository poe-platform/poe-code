import assert from "node:assert/strict";
import test from "node:test";
import { Volume } from "memfs";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { ssconvertCommands } from "../../src/commands/ssconvert/index.js";

test("ssconvert cancellation during admitted CSV stream retires its private publication file", async () => {
  const source = "original,value\nsmall,7\n";
  const volume = Volume.fromJSON({ "/input.csv": source, "/keep.csv": "sentinel" });
  const base = new MemoryFileSystem();
  for (const path of Object.keys(volume.toJSON())) await base.writeFile(path, new Uint8Array(volume.readFileSync(path) as Uint8Array));
  let admitted!: () => void;
  const entered = new Promise<void>(resolve => { admitted = resolve; });
  const fs = new Proxy(base, {
    get(target, key) {
      if (key === "readStream") return undefined;
      if (key === "capabilities") return { ...target.capabilities, streamingRead: false, streamingWrite: true };
      if (key === "capabilitiesFor") return async () => ({ ...target.capabilities, streamingRead: false, streamingWrite: true });
      if (key === "writeStream") return async (_path: string, _bytes: unknown, options: { signal: AbortSignal }) => {
        admitted();
        options.signal.throwIfAborted();
        await new Promise<void>((_resolve, reject) => {
          options.signal.addEventListener("abort", () => { reject(options.signal.reason); }, { once: true });
        });
      };
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  const shell = new Shell({ fs }).use(ssconvertCommands({ codecs: [],
    limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 10, operations: 10000 },
    environment: { env: {}, locale: "C", timezone: "UTC" } }));
  const controller = new AbortController(), reason = { independent: "publication-abort" };
  try {
    const execution = shell.exec("ssconvert -I Gnumeric_stf:stf_csvtab -T Gnumeric_stf:stf_csv /input.csv /keep.csv", { signal: controller.signal });
    await Promise.race([entered, execution.then(result => { throw new Error(`Stream was not admitted: ${result.exitCode} ${result.stderr}`); })]);
    controller.abort(reason);
    await assert.rejects(execution, error => error === reason);
    await shell.dispose();
    assert.equal(new TextDecoder().decode(await base.readFile("/input.csv")), source);
    assert.equal(new TextDecoder().decode(await base.readFile("/keep.csv")), "sentinel");
    assert.deepEqual((await base.readdir("/")).map(entry => entry.name).sort(), ["input.csv", "keep.csv"]);
  } finally { await shell.dispose(); }
});
