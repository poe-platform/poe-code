import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [layouts, speakers] of [
  [["4.0", "FL+FR+FC+BC", "0x107"], ["FL", "FR", "FC", "BC"]],
  [["5.0", "FL+FR+FC+BL+BR", "0x37"], ["FL", "FR", "FC", "BL", "BR"]]
] as const) {
  for (const layout of layouts) for (const option of ["-channel_layout", "-ch_layout"]) {
    for (const speaker of [undefined, ...speakers, "LFE"]) {
      it(`reads raw ${option} ${layout} through ${speaker ?? "anull"}`, async () => {
        const input = Buffer.alloc(3 * speakers.length * 2);
        for (let frame = 0; frame < 3; frame++) for (let channel = 0; channel < speakers.length; channel++) {
          input.writeInt16LE(1000 * (channel + 1) + frame, (frame * speakers.length + channel) * 2);
        }
        const volume = new Volume();
        const output: Buffer[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-hide_banner", "-loglevel", "error", "-f", "s16le", "-ar", "8000",
            "-ac", String(speakers.length), option, layout, "-i", "pipe:0",
            "-filter_complex", `[0:a]${speaker ? `pan=mono|c0=${speaker}` : "anull"}[out]`,
            "-map", "[out]", "-f", "s16le", "pipe:1"],
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
        const expected = speaker ? Buffer.alloc(6) : input;
        const channel = speakers.findIndex(name => name === speaker);
        if (speaker && channel >= 0) for (let frame = 0; frame < 3; frame++) {
          expected.writeInt16LE(1000 * (channel + 1) + frame, frame * 2);
        }
        assert.deepEqual(Buffer.concat(output), expected);
      });
    }
  }
}
