import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 output for eight PCM16 samples of 300 at 8 kHz.
for (const [filter, expected, exitCode] of [
  ["acrusher=mix=none", Array<number>(8).fill(266), 0],
  ["acrusher=mix=all+1", Array<number>(8).fill(266), 0],
  ["acrusher=mode=none", Array<number>(8).fill(283), 0],
  ["acrusher=bits=none+8", Array<number>(8).fill(283), 0],
  ["asendcmd=c='0 acrusher@x mode none',acrusher@x=mode=log", Array<number>(8).fill(283), 0],
  ["acrusher=mix=all", [], 222],
  ["acrusher=bits=none", [], 222],
  ["asetnsamples=n=2:p=0,asendcmd=c='0.0005 acrusher@x mix none',acrusher@x", [283, 283, 283, 283, 266, 266, 266, 266], 0],
  ["asetnsamples=n=2:p=0,asendcmd=c='0.0005 acrusher@x mix all+1',acrusher@x", [283, 283, 283, 283, 266, 266, 266, 266], 0],
  ["asetnsamples=n=2:p=0,asendcmd=c='0.00025 acrusher@x mix all;0.0005 acrusher@x mix none',acrusher@x", [283, 283, 283, 283, 266, 266, 266, 266], 0]
] as const) for (const graph of [false, true]) {
  it(`resolves option constants in ${filter} through ${graph ? "filter_complex" : "af"}`, async () => {
    const volume = Volume.fromJSON({
      "/in.pcm": Buffer.from("2c01".repeat(8), "hex"), "/out.pcm": "keep"
    });
    const chunks: Buffer[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.pcm",
        ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-f", "s16le", exitCode === 0 ? "pipe:1" : "/out.pcm"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, exitCode, stderr);
    const output = Buffer.concat(chunks);
    assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
    assert.equal(stderr, exitCode === 0 ? "" : `ffmpeg: acrusher: invalid ${filter.includes("mix=") ? "mix" : "bits"}\n`);
    assert.equal(volume.readFileSync("/out.pcm", "utf8"), "keep");
  });
}
