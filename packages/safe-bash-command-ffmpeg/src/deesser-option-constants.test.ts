import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: complete PCM16 hashes for this 48-sample WAV.
const inputHash = "75604f234585e206fc03faaf253aecec3035d1b0f0bacdefbf9914f32c485058";
const processedHash = "09bae259460d939a36fabe0ed7e8d009e26a1085bf5a5747e73165d79760f6a9";

for (const [options, exitCode, hash] of [
  ["i=1:s=none", 0, inputHash],
  ["i=1:s=0", 0, inputHash],
  ["i=1:m=none", 0, processedHash],
  ["i=1:m=0", 0, processedHash],
  ["i=1:s=all", 222, undefined],
  ["i=1:s=-1", 222, undefined],
  ["1:0.5:0.5:none", 0, inputHash],
  ["1:none", 0, processedHash],
  ["i=none", 0, inputHash],
  ["i=1:s=all+1", 0, inputHash],
  ["i=1:m=none:threads=none:extra_hw_frames=all", 0, processedHash],
  ["i=1:m=0:threads=0:extra_hw_frames=-1", 0, processedHash],
  ["i=all", 222, undefined],
  ["m=all", 222, undefined],
  ["f=all", 222, undefined],
  ["threads=all", 222, undefined]
] as const) for (const graph of [false, true]) {
  it(`deesser=${options} matches native constants (graph=${graph})`, async () => {
    const fs = new Volume();
    fs.writeFileSync("/in.wav", encodeWav({
      sampleRate: 48000,
      channels: [Float64Array.from({ length: 48 }, (_, i) => ((i * 7919) % 50000 - 25000) / 32768)]
    }, { bitsPerSample: 16 }));
    const filter = `deesser=${options}`;
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.wav", ...(graph
        ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "pipe:1"],
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
    const pcm = Buffer.concat(chunks);
    if (hash !== undefined) {
      assert.equal(stderr, "");
      assert.equal(pcm.length, 96);
      assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
    } else {
      assert.equal(pcm.length, 0);
      assert.ok(stderr.includes("deesser:"), stderr);
    }
  });
}
