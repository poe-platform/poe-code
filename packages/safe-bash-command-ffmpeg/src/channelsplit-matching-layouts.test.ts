import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [layout, speakers] of [
  ["2.1", ["FL", "FR", "LFE"]],
  ["3.0", ["FL", "FR", "FC"]],
  ["3.0(back)", ["FL", "FR", "BC"]],
  ["4.0", ["FL", "FR", "FC", "BC"]],
  ["4.1", ["FL", "FR", "FC", "LFE", "BC"]],
  ["5.0", ["FL", "FR", "FC", "BL", "BR"]],
  ["5.0(side)", ["FL", "FR", "FC", "SL", "SR"]],
  ["6.1", ["FL", "FR", "FC", "LFE", "BC", "SL", "SR"]],
  ["hexagonal", ["FL", "FR", "FC", "BL", "BR", "BC"]],
  ["7.1(wide)", ["FL", "FR", "FC", "LFE", "BL", "BR", "FLC", "FRC"]],
  ["octagonal", ["FL", "FR", "FC", "BL", "BR", "BC", "SL", "SR"]],
  ["7.1", ["FL", "FR", "FC", "LFE", "BL", "BR", "SL", "SR"]]
] as const) {
  for (const [channel, speaker] of speakers.entries()) {
    for (const graph of [false, true]) {
      it(`extracts matching ${layout}:${speaker} (${graph ? "graph" : "simple"})`, async () => {
        const volume = Volume.fromJSON({});
        const input = Buffer.alloc(2 * speakers.length * 2);
        for (let frame = 0; frame < 2; frame++) {
          for (let index = 0; index < speakers.length; index++) {
            input.writeInt16LE(frame === 0 ? 1000 * (index + 1) : 1 - 1000 * (index + 1),
              (frame * speakers.length + index) * 2);
          }
        }
        const output: Buffer[] = [];
        let stderr = "";
        const filter = `channelsplit=channel_layout=${layout}:channels=${speaker}`;
        const result = await createFfmpegCommand().execute({
          args: ["-hide_banner", "-loglevel", "error", "-f", "s16le", "-ar", "8000",
            "-ac", String(speakers.length), "-channel_layout", layout, "-i", "pipe:0",
            ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-f", "s16le", "pipe:1"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () { yield input; })(),
          stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(stderr, "");
        const expected = Buffer.alloc(4);
        expected.writeInt16LE(1000 * (channel + 1), 0);
        expected.writeInt16LE(1 - 1000 * (channel + 1), 2);
        assert.deepEqual(Buffer.concat(output), expected);
      });
    }
  }
}
