import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Interleaved PCM16 captured from native FFmpeg 7.0.2 (13 stereo input frames).
for (const [name, graph, expected] of [
  ["delayed first branch", "[0:a]asplit[a][b];[a]adelay=2S|5S[x];[b]anull[y];[x][y]acrossfade=ns=3:o=1[o]",
    [0, 0, 0, 0, 101, 0, 202, 0, 303, 0, 404, -203, 505, -406, 606, -609, 707, -812, 808, -1015, 909, -1218, 1010, -1421, 1111, -1624, 1212, -1827, 1313, -2030]],
  ["delayed second branch", "[0:a]asplit[a][b];[a]anull[x];[b]adelay=2S|5S[y];[x][y]acrossfade=ns=3:o=1[o]",
    [101, -203, 202, -406, 303, -609, 404, -812, 505, -1015, 606, -1218, 707, -1421, 808, -1624, 909, -1827, 1010, -2030, 740, -1488, 404, -812, 67, 0, 202, 0, 303, 0, 404, -203, 505, -406, 606, -609, 707, -812, 808, -1015, 909, -1218, 1010, -1421, 1111, -1624, 1212, -1827, 1313, -2030, 0, -2233, 0, -2436, 0, -2639]],
  ["zero delay", "[0:a]asplit[a][b];[a]adelay=0|0[x];[b]anull[y];[x][y]acrossfade=ns=3:o=1[o]",
    [101, -203, 202, -406, 303, -609, 404, -812, 505, -1015, 606, -1218, 707, -1421, 808, -1624, 909, -1827, 1010, -2030, 740, -1488, 471, -947, 202, -406, 404, -812, 505, -1015, 606, -1218, 707, -1421, 808, -1624, 909, -1827, 1010, -2030, 1111, -2233, 1212, -2436, 1313, -2639]],
  ["equal delays", "[0:a]asplit[a][b];[a]adelay=5S|5S[x];[b]anull[y];[x][y]acrossfade=ns=3:o=1[o]",
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 101, -203, 202, -406, 303, -609, 404, -812, 505, -1015, 606, -1218, 707, -1421, 808, -1624, 909, -1827, 1010, -2030, 740, -1488, 471, -947, 202, -406, 404, -812, 505, -1015, 606, -1218, 707, -1421, 808, -1624, 909, -1827, 1010, -2030, 1111, -2233, 1212, -2436, 1313, -2639]],
  ["both branches delayed", "[0:a]asplit[a][b];[a]adelay=2S|5S[x];[b]adelay=2S|5S[y];[x][y]acrossfade=ns=3:o=1[o]",
    [0, 0, 0, 0, 101, 0, 202, 0, 303, 0, 404, -203, 505, -406, 606, -609, 707, -812, 808, -1015, 909, -1218, 1010, -1421, 1111, -1624, 1212, -1827, 1313, -2030, 0, -1488, 0, -812, 67, 0, 202, 0, 303, 0, 404, -203, 505, -406, 606, -609, 707, -812, 808, -1015, 909, -1218, 1010, -1421, 1111, -1624, 1212, -1827, 1313, -2030, 0, -2233, 0, -2436, 0, -2639]],
  ["zero delay second branch", "[0:a]asplit[a][b];[a]adelay=2S|5S[x];[b]adelay=0|0[y];[x][y]acrossfade=ns=3:o=1[o]",
    [0, 0, 0, 0, 101, 0, 202, 0, 303, 0, 404, -203, 505, -406, 606, -609, 707, -812, 808, -1015, 909, -1218, 1010, -1421, 1111, -1624, 1212, -1827, 1313, -2030]],
  ["linked named delay", "[0:a]asplit[a][b];[a]acopy[c];[c]adelay@delay=delays=2S|5S,anull[x];[b]acopy[y];[x][y]acrossfade=ns=3:o=0[o]",
    [0, 0, 0, 0, 101, 0, 202, 0, 303, 0, 404, -203, 505, -406, 606, -609, 707, -812, 808, -1015, 909, -1218, 1010, -1421, 1111, -1624, 1212, -1827, 1313, -2030]],
  ["delay before split", "[0:a]adelay=2S|5S,asplit[x][y];[x][y]acrossfade=ns=3:o=1[o]",
    [0, 0, 0, 0, 101, 0, 202, 0, 303, 0, 404, -203, 505, -406, 606, -609, 707, -812, 808, -1015, 909, -1218, 1010, -1421, 1111, -1624, 1212, -1827, 1313, -2030]],
  ["independent inputs", "[0:a]adelay=2S|5S[x];[1:a]anull[y];[x][y]acrossfade=ns=3:o=1[o]",
    [0, 0, 0, 0, 101, 0, 202, 0, 303, 0, 404, -203, 505, -406, 606, -609, 707, -812, 808, -1015, 909, -1218, 1010, -1421, 1111, -1624, 1212, -1827, 1313, -2030, 0, -1488, 67, -947, 202, -406, 404, -812, 505, -1015, 606, -1218, 707, -1421, 808, -1624, 909, -1827, 1010, -2030, 1111, -2233, 1212, -2436, 1313, -2639]]
] as const) {
  it(`acrossfade matches split EOF with ${name}`, async () => {
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
      channels: [101, -203].map(scale => Float64Array.from({ length: 13 }, (_, i) => (i + 1) * scale / 32768)) }));
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.wav", "-i", "/in.wav", "-filter_complex", graph,
        "-map", "[o]", "-f", "s16le", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write(bytes: Uint8Array) { chunks.push(bytes.slice()); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const pcm = Buffer.alloc(expected.length * 2);
    expected.forEach((value, i) => pcm.writeInt16LE(value, i * 2));
    assert.deepEqual(Buffer.concat(chunks), pcm);
  });
}
