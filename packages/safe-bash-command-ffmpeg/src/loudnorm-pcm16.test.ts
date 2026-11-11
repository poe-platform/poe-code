import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// PCM data hashes captured with FFmpeg 7.0.2 for a one-second 8 kHz mono clip.
// Explicit double-resampling controls also match FFmpeg 9.0.1.
for (const [filter, frames, hash] of [
  ["anull", 8000, "00615be1c4bbc2ec2c08836992f10c4becf3190cfa99dbf3f294d01d9e686f81"],
  ["aformat=sample_fmts=dbl,aresample=192000", 192000, "618c213385b8f3f7fd337393c910921663ebd812dfdd39244a82ab94e8e464a5"],
  ["loudnorm", 192000, "7a6f65beb255f3496609004561c2a2bc254b7fd29f24378afeea3fc3c2ee78ef"],
  ["loudnorm=I=-23", 192000, "f0744e6da64d93956c7e8e967b16a3f00c5648502cf02dbd9de9db1e535dd920"],
  ["aformat=sample_fmts=dbl,aresample=192000,loudnorm", 192000, "c3aca158769923b99482387a6c8d3b1a511772592f82e162709264519ab7ef37"],
  ["aformat=sample_fmts=dbl,aresample=192000,loudnorm=I=-23", 192000, "a47ffc16839ba25c468e8fd772e6a00f35db004c3561bd438e83f3bcc66f2631"]
] as const) {
  for (const graph of [false, true]) it(`matches every native PCM16 sample for ${filter} (${graph ? "graph" : "simple"})`, async () => {
    const volume = new Volume();
    volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
      Float64Array.from({ length: 8000 }, (_, i) =>
        (((i * 73 % 97) - 48) * 20 + (i % 40 < 20 ? 3200 : -3200)) / 32768)
    ] }));
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "/in.wav", ...(graph
        ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-c:a", "pcm_s16le", "/out.wav"],
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
    const wav = volume.readFileSync("/out.wav") as Buffer;
    let offset = 12;
    while (wav.toString("ascii", offset, offset + 4) !== "data") {
      assert.ok(offset + 8 <= wav.length, "WAV data chunk exists");
      const size = wav.readUInt32LE(offset + 4);
      offset += 8 + size + (size % 2);
    }
    const pcm = wav.subarray(offset + 8, offset + 8 + wav.readUInt32LE(offset + 4));
    assert.equal(pcm.length, frames * 2);
    assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
  });
}
