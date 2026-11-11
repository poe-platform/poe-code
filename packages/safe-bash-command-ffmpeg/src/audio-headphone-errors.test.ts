import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native Linux FFmpeg 7.0.2 statuses and PCM for these stereo WAV inputs.
for (const [option, exitCode] of [
  ["enable=0", 176], ["foo=1", 8], ["gain=41", 222], ["gain=invalid", 234],
  ["type=time", 0]
] as const) for (const output of ["pipe:1", "/out.pcm"]) {
  it(`headphone ${option} matches native status and output (${output})`, async () => {
    const fs = Volume.fromJSON({ "/out.pcm": "keep" });
    fs.writeFileSync("/in.wav", encodeWav({
      sampleRate: 8000,
      channels: [
        Float64Array.from({ length: 12 }, (_, i) => (5000 + i * 71) / 32768),
        Float64Array.from({ length: 12 }, (_, i) => (-1000 + i * 53) / 32768)
      ]
    }, { bitsPerSample: 16 }));
    fs.writeFileSync("/ir.wav", encodeWav({
      sampleRate: 8000,
      channels: [new Float64Array([0.5, 0, 0.125]), new Float64Array([0, 0.25, 0.125])]
    }, { bitsPerSample: 16 }));
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", "/in.wav", "-i", "/ir.wav", "-i", "/ir.wav",
        "-filter_complex", `[0:a][1:a][2:a]headphone=map=FL|FR:${option}[o]`,
        "-map", "[o]", "-f", "s16le", output],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return fs.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
        async stat(path: string) { return fs.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, exitCode, stderr);
    const stdout = Buffer.concat(chunks);
    if (exitCode !== 0) {
      assert.ok(stderr.includes("headphone"), stderr);
      assert.equal(stdout.length, 0);
      assert.equal(fs.readFileSync("/out.pcm", "utf8"), "keep");
    } else {
      assert.equal(stderr, "");
      const pcm = output === "pipe:1" ? stdout : fs.readFileSync(output) as Buffer;
      assert.equal(pcm.toString("hex"),
        "ea0300000904f5012305ff024a05170371052e0398054503be055d03e50574030c068b033306a2035a06ba038106d103");
    }
  });
}
