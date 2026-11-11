import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseAudio } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: 128 mono PCM16 samples, (i % 16) * 1000, at 8000 Hz.
// Check every PCM byte: intermediate integer conversion changes later samples by one unit.
for (const [filter, samples, hash] of [
  ["aresample=11025,aresample=16000", 257, "aecc7541a88fe5169896e3e0b696274f2a04ac8b13c9bd51c02b010d17e5ad82"],
  ["aformat=r=11025:f=s16", 257, "aecc7541a88fe5169896e3e0b696274f2a04ac8b13c9bd51c02b010d17e5ad82"],
  ["aformat=f=s16:r=11025", 257, "aecc7541a88fe5169896e3e0b696274f2a04ac8b13c9bd51c02b010d17e5ad82"],
  ["aresample=11025", 257, "aecc7541a88fe5169896e3e0b696274f2a04ac8b13c9bd51c02b010d17e5ad82"],
  ["aformat=r=16000", 256, "0a79029748ae06bf1f2c789b046f7c7bfc5deb3ec164d80d666e8533a7a11cda"]
] as const) {
  for (const graph of [false, true]) it(`preserves PCM16 between resamplers: ${filter} (graph=${graph})`, async () => {
    const input = Buffer.alloc(256);
    for (let i = 0; i < 128; i++) input.writeInt16LE((i % 16) * 1000, i * 2);
    const volume = Volume.fromJSON({});
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-hide_banner", "-loglevel", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "pipe:0",
        ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-ar", "16000", "-f", "wav", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () { yield input; })(),
      stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const wav = Buffer.concat(chunks);
    assert.equal(parseWav(wav).tracks[0]!.decodedAudio!.sampleRate, 16000);
    const pcm = Buffer.concat(parseAudio(wav).nodes.filter(node => node.type === "data").map(node => node.data));
    assert.equal(pcm.length / 2, samples);
    assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
  });
}
