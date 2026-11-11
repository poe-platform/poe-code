import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2, eight silent PCM32 samples at 8 kHz, two samples per frame.
for (const [filter, enabledFrames] of [
  ["asendcmd=c='0.0005 dcshift@x enable 0',dcshift@x=0.25", [1, 1, 0, 0]],
  ["asendcmd=c='0.0005 dcshift@x enable 1',dcshift@x=0.25:enable=0", [0, 0, 1, 1]],
  ["asendcmd=c='0.0003 dcshift@x enable 0',dcshift@x=0.25", [1, 1, 0, 0]],
  ["asendcmd=c='0.0005 dcshift enable 0',dcshift@x=0.25", [1, 1, 0, 0]],
  ["asendcmd=c='0.0005 dcshift@y enable 0',dcshift@x=0.25", [1, 1, 1, 1]],
  ["asendcmd=c='0.0005 dcshift@x enable bad',dcshift@x=0.25", [1, 1, 1, 1]],
  ["asendcmd=c='0.0005 dcshift@x shift 0',dcshift@x=0.25", [1, 1, 1, 1]],
  ["asendcmd=c='0.00025 dcshift@x enable 0;0.00075 dcshift@x enable 1',dcshift@x=0.25", [1, 0, 0, 1]],
  ["dcshift@x=0.25,asendcmd=c='0.0005 dcshift@x enable 0'", [1, 1, 1, 0]],
  ["dcshift=0.25:enable='lt(n,2)'", [1, 1, 0, 0]]
] as const) for (const graph of [false, true]) {
  it(`applies ${filter} at frame boundaries (${graph ? "graph" : "simple"})`, async () => {
    const input = Buffer.alloc(44 + 8 * 4);
    input.write("RIFF", 0);
    input.writeUInt32LE(input.length - 8, 4);
    input.write("WAVEfmt ", 8);
    input.writeUInt32LE(16, 16);
    input.writeUInt16LE(1, 20);
    input.writeUInt16LE(1, 22);
    input.writeUInt32LE(8000, 24);
    input.writeUInt32LE(32000, 28);
    input.writeUInt16LE(4, 32);
    input.writeUInt16LE(32, 34);
    input.write("data", 36);
    input.writeUInt32LE(32, 40);
    const volume = Volume.fromJSON({ "/in.wav": input });
    const chain = `asetnsamples=n=2:p=0,${filter}`;
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.wav",
        ...(graph ? ["-filter_complex", `[0:a]${chain}[o]`, "-map", "[o]"] : ["-af", chain]),
        "-f", "s32le", "/out.raw"],
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
    const expected = Buffer.alloc(32);
    enabledFrames.forEach((enabled, frame) => {
      expected.writeInt32LE(enabled * 536870912, frame * 8);
      expected.writeInt32LE(enabled * 536870912, frame * 8 + 4);
    });
    assert.deepEqual(volume.readFileSync("/out.raw"), expected);
  });
}
