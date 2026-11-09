import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, createFfprobeCommand } from "./index.js";

for (const mask of [3, 12]) for (const input of ["/in.aiff", "pipe:0"]) {
  for (const probe of [false, true]) {
    it(`${probe ? "probes" : "downmixes"} AIFF speaker bitmap ${mask} from ${input}`, async () => {
      const bytes = Buffer.from("464f524d0000005241494646434f4d4d000000120002000000040010400bfa000000000000004348414e0000000c000100000000000c0000000053534e4400000018000000000000000003e8232807d01f400bb81b580fa01770", "hex");
      bytes.writeUInt32BE(mask, 50);
      const volume = Volume.fromJSON({ "/in.aiff": bytes });
      let stdout = "", stderr = "";
      const command = probe ? createFfprobeCommand() : createFfmpegCommand();
      const result = await command.execute({
        args: probe ? ["-v", "error", "-show_streams", "-of", "json", input]
          : ["-y", "-v", "error", "-i", input, "-ac", "1", "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () { if (input === "pipe:0") yield bytes; })(),
        stdout: { async write(data: Uint8Array) { stdout += new TextDecoder().decode(data); } },
        stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      if (probe) {
        assert.equal(JSON.parse(stdout).streams[0].channel_layout, mask === 12 ? "2 channels (FC+LFE)" : "stereo");
      } else {
        const output = volume.readFileSync("/out.raw") as Buffer;
        assert.equal(output.length, 8);
        assert.deepEqual([0, 2, 4, 6].map(offset => output.readInt16LE(offset)),
          mask === 12 ? [1000, 2000, 3000, 4000] : [5000, 5000, 5000, 5000]);
      }
    });
  }
}
