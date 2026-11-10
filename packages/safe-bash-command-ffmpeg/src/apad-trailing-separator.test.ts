import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const options of ["pad_len=4", "pad_len=4:", "pad_len=4::", "pad_len="]) {
  it(`apad=${options} accepts one trailing separator without accepting empty options`, async () => {
    const volume = new Volume();
    const input = Buffer.alloc(16);
    for (let index = 0; index < 8; index++) input.writeInt16LE(index + 1, index * 2);
    volume.writeFileSync("/in.raw", input);
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
        "-af", `apad=${options}`, "-t", "0.004", "-f", "s16le", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    if (options === "pad_len=4::" || options === "pad_len=") {
      assert.notEqual(result.exitCode, 0);
      assert.equal(volume.existsSync("/out.raw"), false);
    } else {
      assert.equal(result.exitCode, 0, stderr);
      const output = volume.readFileSync("/out.raw") as Buffer;
      assert.deepEqual(Array.from({ length: output.length / 2 }, (_, index) => output.readInt16LE(index * 2)),
        [1, 2, 3, 4, 5, 6, 7, 8, 0, 0, 0, 0]);
    }
  });
}
