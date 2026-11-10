import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const frames = [[101, -901], [202, -802], [303, -703]];
for (const channels of [8, 9, 10]) {
  for (const complex of [false, true]) {
    it(`infers ${channels} channelmap outputs without a layout (${complex ? "graph" : "simple"})`, async () => {
      const volume = new Volume();
      const input = Buffer.alloc(frames.length * 4);
      frames.flat().forEach((sample, index) => input.writeInt16LE(sample, index * 2));
      volume.writeFileSync("/in.raw", input);
      const filter = `channelmap=${Array.from({ length: channels }, (_, index) => index % 2).join("|")}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter]),
          "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const output = volume.readFileSync("/out.raw") as Buffer;
      assert.deepEqual(
        Array.from({ length: output.length / 2 }, (_, index) => output.readInt16LE(index * 2)),
        frames.flatMap(frame => Array.from({ length: channels }, (_, index) => frame[index % 2]))
      );
    });
  }
}
