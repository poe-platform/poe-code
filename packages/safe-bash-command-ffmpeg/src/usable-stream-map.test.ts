import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Complete s16le stdout and statuses from native FFmpeg 7.0.2.
for (const [maps, exitCode, hex] of [
  [["1:u?"], 0, "4c0450fb140588fa"],
  [["1:u"], 0, "4c0450fb140588fa"],
  [["1:a:u"], 0, "4c0450fb140588fa"],
  [["1:a:u?"], 0, "4c0450fb140588fa"],
  [["1:a:0"], 0, "4c0450fb140588fa"],
  [["1:a:1?"], 0, "640038ff2c0170fe"],
  [["0:u", "1:u", "-0:a:u"], 0, "4c0450fb140588fa"],
  [["1:v:u?"], 0, "640038ff2c0170fe"],
  [["1:v:u"], 234, ""]
] as const) {
  it(`maps usable WAV streams with ${maps.join(" ")}`, async () => {
    const volume = Volume.fromJSON({});
    for (const [name, channels] of [
      ["a", [[100, 300], [-200, -400]]],
      ["b", [[1100, 1300], [-1200, -1400]]]
    ] as const) {
      volume.writeFileSync(`/${name}.wav`, encodeWav({ sampleRate: 8000,
        channels: channels.map(samples => Float64Array.from(samples, value => value / 32768)) }));
    }
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/a.wav", "-i", "/b.wav",
        ...maps.flatMap(map => ["-map", map]), "-f", "s16le", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, exitCode, stderr);
    assert.equal(Buffer.concat(stdout).toString("hex"), hex);
  });
}
