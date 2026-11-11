import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: WAV exposes stream ID zero independently of AST track IDs.
for (const [maps, exitCode, hex] of [
  [["1:#0?"], 0, "4c0450fb140588fa"],
  [["1:#0"], 0, "4c0450fb140588fa"],
  [["1:i:0"], 0, "4c0450fb140588fa"],
  [["1:i:0x0"], 0, "4c0450fb140588fa"],
  [["1:i:1"], 234, ""],
  [["1:i:1?"], 0, "640038ff2c0170fe"],
  [["1:0"], 0, "4c0450fb140588fa"],
  [["1:a:0"], 0, "4c0450fb140588fa"],
  [["1:a:#0"], 0, "4c0450fb140588fa"],
  [["1:a:i:0"], 0, "4c0450fb140588fa"],
  [["1:#1"], 234, ""],
  [["0", "1", "-0:#0"], 0, "4c0450fb140588fa"],
] as const) {
  it(`maps WAV stream ID zero with ${maps.join(" ")}`, async () => {
    const volume = Volume.fromJSON(Object.fromEntries(([
      ["/a.wav", [100, -200, 300, -400]],
      ["/b.wav", [1100, -1200, 1300, -1400]],
    ] as const).map(([path, samples]) => [path, Buffer.from(encodeWav({
      sampleRate: 8000,
      channels: [0, 1].map(channel => Float64Array.from(
        samples.filter((_, index) => index % 2 === channel), value => value / 32768)),
    }))])));
    const stdout: Buffer[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/a.wav", "-i", "/b.wav",
        ...maps.flatMap(map => ["-map", map]), "-f", "s16le", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); },
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } },
    } as never);
    assert.equal(result.exitCode, exitCode, stderr);
    assert.equal(Buffer.concat(stdout).toString("hex"), hex);
    if (exitCode) assert.match(stderr, /matches no streams/);
  });
}
